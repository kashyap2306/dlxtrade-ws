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
import { getFirebaseAdmin } from '../utils/firebase';
import { decrypt } from './keyManager';

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
      const db = getFirebaseAdmin().firestore();
      const usersSnapshot = await db
        .collection('users')
        .where('approvedAgents', 'array-contains', 'VWAP_STRATEGY')
        .get();

      const usersWithVWAPAccess = usersSnapshot.docs.map((d) => d.id);

      this.activeVWAPStrategies.clear();

      for (const userId of usersWithVWAPAccess) {
        // For now, create a basic VWAP strategy config
        // In production, this would be stored in user preferences or agent settings
        const vwapConfig: VWAPStrategyConfig = {
          userId,
          agentId: `vwap_${userId}`,
          tradingPair: 'BTC/USDT', // Default, could be configurable
          marketType: 'futures',
          exchange: 'binance', // Actual exchange comes from runtime credentials
          riskPerTrade: 0.02, // 2%
          apiKey: '', // Would need to get from user's exchange settings
          apiSecret: '',
          dryRun: false
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
      // CRITICAL: Check if agent was manually stopped by user
      // Manual STOP must override everything - do NOT run any logic
      const currentAgentConfig = await firestoreAdapter.getTradingAgentConfig(agentId);
      if (!currentAgentConfig || currentAgentConfig.status === 'STOPPED') {
        logger.debug({
          agentId,
          userId: agentConfig.userId,
          status: currentAgentConfig?.status || 'NOT_FOUND'
        }, 'Trading Agent is STOPPED - skipping execution cycle');
        return; // Exit immediately - no diagnostics, no scan
      }

      // Also check for PAUSED status
      if (currentAgentConfig.status === 'PAUSED') {
        diagnostics.decision = { action: 'SKIP', reason: 'AGENT_PAUSED' };
        await agent.storeDiagnostics(diagnostics);
        logger.debug({ agentId }, 'Trading Agent is PAUSED - skipping execution cycle');
        return;
      }
      // Create agent-specific market provider using canonical exchange config
      const exchangeConfig = await firestoreAdapter.getExchangeConfig(agentConfig.userId);
      if (!exchangeConfig?.exchange) {
        diagnostics.decision = { action: 'SKIP', reason: 'EXCHANGE_NOT_FOUND' };
        await agent.storeDiagnostics(diagnostics);
        logger.warn({ agentId, uid: agentConfig.userId }, 'SKIP: EXCHANGE_NOT_FOUND - no exchange connected');
        return;
      }

      const encryptedApiKey = exchangeConfig.apiKeyEncrypted;
      const encryptedSecret = exchangeConfig.secretKeyEncrypted || exchangeConfig.secretEncrypted;
      const encryptedPassphrase = exchangeConfig.passphraseEncrypted;

      if (!encryptedApiKey || !encryptedSecret) {
        diagnostics.decision = { action: 'SKIP', reason: 'EXCHANGE_CREDENTIALS_NOT_FOUND' };
        await agent.storeDiagnostics(diagnostics);
        logger.warn({ 
          agentId, 
          uid: agentConfig.userId, 
          exchange: exchangeConfig.exchange,
          hasApiKey: !!encryptedApiKey,
          hasSecret: !!encryptedSecret
        }, 'SKIP: EXCHANGE_CREDENTIALS_NOT_FOUND - encrypted keys missing');
        return;
      }

      const apiKey = encryptedApiKey ? decrypt(encryptedApiKey, 'background_job') : null;
      const secret = encryptedSecret ? decrypt(encryptedSecret, 'background_job') : null;
      const passphrase = encryptedPassphrase ? decrypt(encryptedPassphrase, 'background_job') : undefined;

      if (!apiKey || !secret) {
        diagnostics.decision = { action: 'SKIP', reason: 'EXCHANGE_CREDENTIALS_DECRYPT_FAILED' };
        await agent.storeDiagnostics(diagnostics);
        logger.error({ 
          agentId, 
          uid: agentConfig.userId, 
          exchange: exchangeConfig.exchange,
          decryptedApiKey: !!apiKey,
          decryptedSecret: !!secret
        }, 'SKIP: EXCHANGE_CREDENTIALS_DECRYPT_FAILED - decryption returned null');
        return;
      }

      // Debug log (temporary)
      logger.debug({
        agentId,
        uid: agentConfig.userId,
        exchange: exchangeConfig.exchange,
        credentialsResolved: true
      }, 'Trading Agent credentials successfully resolved');

      const exchangeCredentials: ExchangeCredentials = {
        apiKey,
        secret,
        passphrase,
        testnet: exchangeConfig.testnet ?? false,
      };

      // Normalize exchange name to lowercase
      const normalizedExchange = String(exchangeConfig.exchange || agentConfig.exchange).toLowerCase();
      const marketProvider = new TradingAgentMarketProvider(exchangeCredentials, normalizedExchange as any, 'futures');

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

      // IMPORTANT: Our indicator library expects candles in "most recent first" order.
      // Many exchanges return klines oldest->newest.
      candles.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      // Get latest candle (most recent)
      const latestCandle = candles[0];
      const candleTimestamp = new Date(latestCandle.timestamp);

      // Update diagnostics with candle info
      diagnostics.candleCheck = {
        isClosed: true, // Assuming we only get closed candles
        candleTimestamp,
        price: latestCandle.close
      };

      // ===== OPEN TRADE MANAGEMENT (SL/TP) =====
      // If there's an open position for this agent+pair, manage exits first.
      try {
        const recentAgentTrades = await firestoreAdapter.getAgentTrades(agentId, 25);
        const openTradesForPair = (recentAgentTrades || []).filter((t: any) => {
          return t?.status === 'OPEN' && String(t?.tradingPair || '').toUpperCase() === String(tradingPair).toUpperCase();
        });

        if (openTradesForPair.length > 0) {
          const openTrade = openTradesForPair[0];
          const currentPrice = Number(latestCandle.close) || 0;
          const entryPrice = Number(openTrade.entryPrice) || 0;
          const qty = Number(openTrade.quantity) || 0;
          const sl = Number(openTrade.stopLoss);
          const tp = Number(openTrade.takeProfit);

          if (currentPrice > 0 && entryPrice > 0 && qty > 0 && isFinite(sl) && isFinite(tp)) {
            const isLong = openTrade.direction === 'LONG';
            const hitSL = isLong ? currentPrice <= sl : currentPrice >= sl;
            const hitTP = isLong ? currentPrice >= tp : currentPrice <= tp;

            if (hitSL || hitTP) {
              const closeSide: 'BUY' | 'SELL' = isLong ? 'SELL' : 'BUY';
              await marketProvider.placeOrder({
                symbol,
                side: closeSide,
                type: 'MARKET',
                quantity: qty,
              });

              const pnl = isLong ? (currentPrice - entryPrice) * qty : (entryPrice - currentPrice) * qty;
              await firestoreAdapter.updateTradeStatus(openTrade.id, 'CLOSED');

              if (openTrade.tradeDocId) {
                await firestoreAdapter.updateTradeDocDelta(openTrade.tradeDocId, {
                  status: 'closed',
                  exitPrice: currentPrice,
                  pnl,
                });
              }

              // Update daily counters: consecutive losses stop at 2
              const counters = await firestoreAdapter.getDailySafetyCounters(agentId);
              const nextDailyPnL = (Number(counters.dailyPnL) || 0) + pnl;
              const nextConsecutiveLosses = pnl < 0 ? (Number(counters.consecutiveLosses) || 0) + 1 : 0;
              await firestoreAdapter.updateDailySafetyCounters(agentId, {
                dailyPnL: nextDailyPnL,
                consecutiveLosses: nextConsecutiveLosses,
              });

              logger.info({ agentId, tradingPair, openTradeId: openTrade.id, pnl }, 'Closed open trade by SL/TP');
            }
          }

          // Do not open a new trade while one is open/managed
          await firestoreAdapter.updateLastProcessedCandle(agentId, tradingPair, candleTimestamp);
          return;
        }
      } catch (error) {
        // Non-fatal - continue with normal flow
      }

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

      const maxTradesPerDay = Math.min(Number(agentConfig.maxTradesPerDay) || 5, 5);

      // Check daily trade limit
      if (dailyCounters.tradesToday >= maxTradesPerDay) {
        diagnostics.decision = { action: 'SKIP', reason: `Daily trade limit reached: ${dailyCounters.tradesToday}/${maxTradesPerDay}` };
        await agent.storeDiagnostics(diagnostics);
        logger.info({
          agentId,
          tradesToday: dailyCounters.tradesToday,
          maxTrades: maxTradesPerDay,
          reason: 'DAILY_TRADE_LIMIT'
        }, 'Execution blocked: daily trade limit reached');
        await firestoreAdapter.updateLastProcessedCandle(agentId, tradingPair, candleTimestamp);
        return;
      }

      // Check consecutive losses limit
      if (dailyCounters.consecutiveLosses >= 2) {
        diagnostics.decision = { action: 'SKIP', reason: `Consecutive losses limit: ${dailyCounters.consecutiveLosses}/2` };
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
      const positionTrades = await firestoreAdapter.getAgentTrades(agentId, 50);
      const openTrades = (positionTrades || []).filter((t: any) => t?.status === 'OPEN');
      const pairOpenTrades = openTrades.filter((t: any) => String(t?.tradingPair || '').toUpperCase() === String(tradingPair).toUpperCase());
      const positionCounts = {
        pairPositions: pairOpenTrades.length,
        totalPositions: openTrades.length,
      };

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

      // Position sizing (validation-only)
      const positionCalc = agent.calculatePositionSize(
        balance.equity,
        signal.entryPrice,
        signal.stopLoss,
        agentConfig.leverage || 8,
      );

      if (!positionCalc.isSafe || !isFinite(positionCalc.positionSize) || positionCalc.positionSize <= 0) {
        diagnostics.decision = {
          action: 'SKIP',
          reason: `Position sizing rejected: ${positionCalc.reason || 'UNKNOWN'}`
        };
        await agent.storeDiagnostics(diagnostics);
        await firestoreAdapter.updateLastProcessedCandle(agentId, tradingPair, candleTimestamp);
        return;
      }

      const tradeRecord: any = {
        id: `trade_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        signalId: signal.signalId,
        agentId: agentId,
        tradingPair: agentConfig.tradingPair,
        symbol: symbol,
        direction: signal.direction,
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        quantity: positionCalc.positionSize,
        status: 'OPEN',
        entryTime: signal.timestamp,
        candleTimestamp: signal.candleTimestamp,
        indicators: signal.indicators,
      };

      // Update diagnostics with risk analysis
      diagnostics.riskAnalysis.positionSize = tradeRecord.quantity;

      // Place actual order on exchange (MARKET entry) and persist to trades collection
      const orderSuccess = await this.placeOrderFromTradeAtomic(tradeRecord, agentConfig, marketProvider, diagnostics, agent);

      if (orderSuccess) {
        // Also persist to agentTrades for idempotency / position count enforcement
        await firestoreAdapter.saveAgentTrade(tradeRecord);

        // Update daily counters
        await firestoreAdapter.updateDailySafetyCounters(agentId, {
          tradesToday: dailyCounters.tradesToday + 1
        });

        // Set pair cooldown (30 minutes from trade execution)
        const cooldownUntil = new Date(Date.now() + 30 * 60 * 1000);
        await firestoreAdapter.setPairCooldown(agentId, tradingPair, cooldownUntil);

        logger.info({
          agentId,
          tradeId: tradeRecord.id,
          signalId: tradeRecord.signalId,
          direction: tradeRecord.direction,
          entryPrice: tradeRecord.entryPrice,
          quantity: tradeRecord.quantity
        }, 'Trade executed successfully with all safety checks');
      } else {
        tradeRecord.status = 'FAILED';
        tradeRecord.error = diagnostics?.execution?.error || 'ORDER_PLACEMENT_FAILED';
        await firestoreAdapter.saveAgentTrade(tradeRecord);

        logger.error({
          agentId,
          tradeId: tradeRecord.id,
          signalId: tradeRecord.signalId
        }, 'Order placement failed, trade marked as failed');
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

      // Get daily trade count (AGGRESSIVE TUNED: increased to 12)
      const dailyTradeCount = await CrowdConsensusService.getDailyTradeCount('crowd-consensus-user');

      if (dailyTradeCount >= 12) {
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
    try {
      const uid = agentConfig.userId;
      const agentName = String(agentConfig.name || '');
      const agentSlug = agentName.toLowerCase().includes('liquidity sweep')
        ? 'liquidity_sniper_arbitrage'
        : 'trading-agent';

      const side: 'BUY' | 'SELL' = trade.direction === 'LONG' ? 'BUY' : 'SELL';
      const symbol = (trade.symbol || agentConfig.tradingPair.replace('/', '')).toUpperCase();
      const quantity = Number(trade.quantity) || 0;

      if (!uid) {
        diagnostics.execution = { success: false, error: 'MISSING_USER_ID' };
        await agent.storeDiagnostics(diagnostics);
        return false;
      }

      if (!symbol || !isFinite(quantity) || quantity <= 0) {
        diagnostics.execution = { success: false, error: 'INVALID_ORDER_PARAMS' };
        await agent.storeDiagnostics(diagnostics);
        return false;
      }

      // Place entry order (MARKET). SL/TP are stored and managed by our engine.
      const orderId = await marketProvider.placeOrder({
        symbol,
        side,
        type: 'MARKET',
        quantity,
      });

      diagnostics.execution = {
        success: true,
        orderId,
      };
      await agent.storeDiagnostics(diagnostics);

      // Persist to canonical trades collection for UI history
      const tradeDocId = await firestoreAdapter.saveTrade(uid, {
        symbol: agentConfig.tradingPair,
        side,
        qty: quantity,
        entryPrice: Number(trade.entryPrice) || 0,
        engineType: 'auto',
        orderId,
        exchange: agentConfig.exchange,
        leverage: agentConfig.leverage,
        riskPercent: agentConfig.riskPerTrade,
        status: 'open',
        metadata: {
          agentId: agentSlug,
          signalId: trade.signalId,
          tradeId: trade.id,
          direction: trade.direction,
          stopLoss: trade.stopLoss,
          takeProfit: trade.takeProfit,
        },
      });

      (trade as any).tradeDocId = tradeDocId;

      logger.info({
        uid,
        agentId: agentConfig.id,
        agentSlug,
        orderId,
        symbol,
        side,
        quantity,
      }, 'Trade entry order placed and persisted');

      return true;
    } catch (error) {
      diagnostics.execution = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      try {
        await agent.storeDiagnostics(diagnostics);
      } catch { }

      logger.error({
        agentId: agentConfig.id,
        tradeId: trade?.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 'Failed to place trade entry order');
      return false;
    }
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
      const todayKey = new Date().toISOString().slice(0, 10);
      const runtimeState = vwapRuntimeService.getAgentState(userId);
      if (!runtimeState) {
        return;
      }

      // CRITICAL: Check if agent was manually stopped by user
      // Manual STOP must override everything - do NOT run any logic
      if (runtimeState.status === 'STOPPED') {
        logger.debug({
          agentId,
          userId,
          status: 'STOPPED'
        }, 'VWAP agent is STOPPED - skipping execution cycle (no heartbeat, no scan)');
        return; // Exit immediately - no heartbeat, no diagnostics, no scan
      }

      if (runtimeState.stoppedForDayKey === todayKey) {
        return;
      }

      const storeVWAPDiagnostics = async (diagnostics: any) => {
        try {
          const { TradingAgent } = await import('./tradingAgent');
          const agent = new TradingAgent({
            id: `vwap_${userId}`,
            userId,
            name: 'VWAP Strategy',
            tradingPair: (strategy.config?.tradingPair || 'BTC/USDT') as any,
            marketType: 'futures',
            exchange: (runtimeState.exchange || 'bitget') as any,
            leverage: 5,
            riskPerTrade: 2,
            maxConcurrentTrades: 1,
            maxTradesPerDay: 5,
            apiKey: '',
            apiSecret: '',
            passphrase: runtimeState.credentials?.passphrase,
            dryRun: false,
            status: 'ACTIVE',
            createdAt: new Date(),
            dailyTrades: 0,
            consecutiveLosses: 0,
            dailyPnL: 0,
            totalPnL: 0,
            winRate: 0,
            totalTrades: 0,
            winningTrades: 0,
            losingTrades: 0,
            drawdown: 0,
          } as any);
          await agent.storeDiagnostics(diagnostics);
        } catch (e) {
        }
      };

      if (!runtimeState.exchange || !runtimeState.credentials?.apiKey || !runtimeState.credentials?.secret) {
        // FIX: Do NOT stop agent - only SKIP this cycle
        // Agent must remain RUNNING and continue scanning
        await storeVWAPDiagnostics({
          timestamp: new Date(),
          agentId: `vwap_${userId}`,
          tradingPair: strategy.config?.tradingPair || 'BTC/USDT',
          sessionCheck: { isValidSession: true, currentIST: '', reason: 'EXCHANGE_NOT_CONNECTED' },
          candleCheck: {},
          indicators: {},
          supportResistance: { calculated: false },
          signal: { direction: null, entryPrice: 0, stopLoss: 0, takeProfit: 0, rrRatio: 0, meetsConditions: false },
          riskAnalysis: {},
          srValidation: {},
          decision: { action: 'SKIP', reason: 'EXCHANGE_NOT_CONNECTED' },
        });
        
        logger.warn({
          agentId: `vwap_${userId}`,
          userId,
          reason: 'EXCHANGE_NOT_CONNECTED'
        }, 'SKIP: VWAP execution - exchange not connected (agent remains RUNNING)');
        
        // Update heartbeat to keep agent alive
        await vwapRuntimeService.updateHeartbeat(userId);
        return;
      }

      const exchangeCredentials: ExchangeCredentials = {
        apiKey: runtimeState.credentials.apiKey,
        secret: runtimeState.credentials.secret,
        passphrase: runtimeState.credentials.passphrase,
        testnet: runtimeState.credentials.testnet ?? false,
      };

      const tradingPair = strategy.config?.tradingPair || 'BTC/USDT';
      const symbol = tradingPair.replace('/', '').toUpperCase();

      const marketProvider = new TradingAgentMarketProvider(exchangeCredentials, runtimeState.exchange, 'futures');

      try {
        await marketProvider.setMarginType(symbol, 'ISOLATED');
      } catch (e) {
        logger.warn({ agentId, userId, error: (e as any)?.message }, 'VWAP: setMarginType failed (continuing)');
      }
      try {
        await marketProvider.setLeverage(symbol, 5);
      } catch (e) {
        logger.warn({ agentId, userId, error: (e as any)?.message }, 'VWAP: setLeverage failed (continuing)');
      }

      const recentTrades = await firestoreAdapter.getTrades(userId, 200);
      const todayTrades = (recentTrades || []).filter((t: any) => {
        const ts = t?.timestamp ? new Date(t.timestamp) : null;
        const tsKey = ts && !isNaN(ts.getTime()) ? ts.toISOString().slice(0, 10) : null;
        const metaAgentId = t?.metadata?.agentId;
        return tsKey === todayKey && metaAgentId === 'vwap-strategy';
      });

      const openTrades = todayTrades.filter((t: any) => (t?.status || '').toLowerCase() === 'open');
      const closedTrades = todayTrades.filter((t: any) => (t?.status || '').toLowerCase() === 'closed');

      if (!runtimeState.dayKey || runtimeState.dayKey !== todayKey || typeof runtimeState.dayStartEquity !== 'number') {
        try {
          const bal = await marketProvider.getAccountBalance();
          runtimeState.dayKey = todayKey;
          runtimeState.dayStartEquity = bal.equity;
        } catch (e) {
        }
      }

      const realizedPnL = closedTrades.reduce((sum: number, t: any) => sum + (Number(t?.pnl) || 0), 0);
      const tradesToday = todayTrades.length;
      const dayStartEquity = typeof runtimeState.dayStartEquity === 'number' ? runtimeState.dayStartEquity : 0;

      const consecutiveLosses = (() => {
        const sorted = [...closedTrades].sort((a: any, b: any) => {
          const at = a?.timestamp ? new Date(a.timestamp).getTime() : 0;
          const bt = b?.timestamp ? new Date(b.timestamp).getTime() : 0;
          return bt - at;
        });
        let n = 0;
        for (const t of sorted) {
          const pnl = Number(t?.pnl);
          if (!isFinite(pnl)) continue;
          if (pnl < 0) n++;
          else break;
        }
        return n;
      })();

      if (tradesToday >= 5) {
        await vwapRuntimeService.stopAgentForDay(userId, 'MAX_TRADES_PER_DAY', todayKey);
        await storeVWAPDiagnostics({
          timestamp: new Date(),
          agentId: `vwap_${userId}`,
          tradingPair: strategy.config?.tradingPair || 'BTC/USDT',
          decision: { action: 'SKIP', reason: 'STOPPED_FOR_DAY_MAX_TRADES' },
        });
        return;
      }

      if (dayStartEquity > 0) {
        const dailyLossPct = (realizedPnL / dayStartEquity) * 100;
        if (dailyLossPct <= -4) {
          await vwapRuntimeService.stopAgentForDay(userId, 'DAILY_MAX_LOSS', todayKey);
          await storeVWAPDiagnostics({
            timestamp: new Date(),
            agentId: `vwap_${userId}`,
            tradingPair: strategy.config?.tradingPair || 'BTC/USDT',
            decision: { action: 'SKIP', reason: 'STOPPED_FOR_DAY_DAILY_MAX_LOSS' },
          });
          return;
        }
      }

      if (consecutiveLosses >= 2) {
        await vwapRuntimeService.stopAgentForDay(userId, 'CONSECUTIVE_LOSSES', todayKey);
        await storeVWAPDiagnostics({
          timestamp: new Date(),
          agentId: `vwap_${userId}`,
          tradingPair: strategy.config?.tradingPair || 'BTC/USDT',
          decision: { action: 'SKIP', reason: 'STOPPED_FOR_DAY_CONSECUTIVE_LOSSES' },
        });
        return;
      }

      if (openTrades.length > 0) {
        const trade = openTrades[0];
        const stopLoss = Number(trade?.metadata?.stopLoss);
        const takeProfit = Number(trade?.metadata?.takeProfit);
        const entryPrice = Number(trade?.entryPrice);
        const qty = Number(trade?.qty);
        const side = (trade?.side || '').toLowerCase();

        if (isFinite(stopLoss) && isFinite(takeProfit) && isFinite(entryPrice) && isFinite(qty) && qty > 0) {
          const candles = await marketProvider.getCandles(symbol, '5m', 2);
          const last = candles?.length ? candles[candles.length - 1] : null;
          const lastHigh = Number(last?.high) || 0;
          const lastLow = Number(last?.low) || 0;
          const currentPrice = Number(last?.close) || 0;

          let shouldClose = false;
          if (side === 'buy') {
            if (lastHigh >= takeProfit || lastLow <= stopLoss) shouldClose = true;
          } else {
            if (lastLow <= takeProfit || lastHigh >= stopLoss) shouldClose = true;
          }

          if (shouldClose && trade?.id) {
            const pnl = side === 'buy' ? (currentPrice - entryPrice) * qty : (entryPrice - currentPrice) * qty;
            await firestoreAdapter.updateTradeDocDelta(trade.id, {
              status: 'closed',
              exitPrice: currentPrice,
              pnl,
            });
          }
        }

        await vwapRuntimeService.updateHeartbeat(userId);
        return;
      }

      const diagnostics = await strategy.execute(marketProvider);

      // Persist diagnostics so UI can show RUNNING / SKIPPED / EXECUTED
      await storeVWAPDiagnostics({
        agentId: `vwap_${userId}`,
        tradingPair: diagnostics?.tradingPair || strategy.config?.tradingPair || 'BTC/USDT',
        timestamp: diagnostics?.timestamp || new Date(),
        sessionCheck: diagnostics?.sessionCheck,
        candleCheck: diagnostics?.candleCheck || {},
        indicators: diagnostics?.indicators || {},
        supportResistance: diagnostics?.supportResistance || { calculated: false },
        signal: {
          direction: diagnostics?.signal?.direction || null,
          entryPrice: diagnostics?.signal?.entryPrice || 0,
          stopLoss: diagnostics?.signal?.stopLoss || 0,
          takeProfit: diagnostics?.signal?.takeProfit || 0,
          rrRatio: diagnostics?.signal?.rrRatio || 0,
          meetsConditions: diagnostics?.signal?.meetsConditions || false,
        },
        riskAnalysis: diagnostics?.riskAnalysis || {},
        srValidation: diagnostics?.srValidation || {},
        decision: diagnostics?.decision || { action: 'SKIP', reason: 'UNKNOWN' },
        execution: diagnostics?.execution,
      });

      if (diagnostics?.decision?.action === 'TRADE' && diagnostics?.execution?.success && diagnostics?.execution?.orderId) {
        const direction = diagnostics?.signal?.direction;
        const side: 'BUY' | 'SELL' = direction === 'LONG' ? 'BUY' : 'SELL';
        const qty = Number(diagnostics?.riskAnalysis?.positionSize) || 0;
        const entryPrice = Number(diagnostics?.signal?.entryPrice) || 0;

        if (qty > 0 && entryPrice > 0) {
          await firestoreAdapter.saveTrade(userId, {
            symbol,
            side,
            qty,
            entryPrice,
            engineType: 'auto',
            orderId: diagnostics.execution.orderId,
            exchange: runtimeState.exchange,
            leverage: 5,
            riskPercent: 2,
            status: 'open',
            metadata: {
              agentId: 'vwap-strategy',
              stopLoss: diagnostics?.signal?.stopLoss,
              takeProfit: diagnostics?.signal?.takeProfit,
              direction,
            },
          });
        }
      }

      // Update runtime heartbeat
      await vwapRuntimeService.updateHeartbeat(userId);

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