import { logger } from '../utils/logger';
import { TradingAgent, TradingAgentConfig, TradingSignal } from './tradingAgent';
import { VWAPStrategy, VWAPStrategyConfig } from './vwapStrategy';
import { TechnicalIndicators, CandleData, IndicatorValues } from './technicalIndicators';
import { firestoreAdapter, isExchangeUsable } from './firestoreAdapter';
import { TradingAgentMarketProvider } from './tradingAgentMarketProvider';
import { ExchangeCredentials } from './exchangeConnector';
import { CrowdConsensusService } from './crowdConsensusService';
import { AgentApprovalService } from './agentApprovalService';
import { vwapRuntimeService } from './vwapRuntimeService';
import { getFirebaseAdmin } from '../utils/firebase';
import { decrypt } from './keyManager';
import { BBRsiEma200ScalperStrategy } from './bbRsiEma200ScalperStrategy';

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
  private static manualTradeExecutionGuard: Map<string, number> = new Map(); // userId+agentId -> timestamp

  constructor(marketDataProvider: MarketDataProvider) {
    this.marketDataProvider = marketDataProvider;
  }

  /**
   * CRITICAL: Strict diagnostics normalization before Firestore persistence
   * Enforces invariants to prevent stale exchange errors and undefined field issues
   */
  private normalizeDiagnosticsForPersistence(diagnostics: any, agentId: string): any {
    // Create a clean copy to avoid mutating the original
    const normalized: any = {};

    // EXECUTION STATUS RULE: success === true → EXECUTED, success === false → FAILED, else → SKIPPED
    if (diagnostics.execution?.success === true) {
      normalized.executionStatus = 'EXECUTED';
    } else if (diagnostics.execution?.success === false) {
      normalized.executionStatus = 'FAILED';
    } else {
      normalized.executionStatus = 'SKIPPED';
    }

    // CRITICAL INVARIANT: If exchange is usable, NEVER allow exchange error messages
    const exchangeUsable = diagnostics.exchangeUsable === true;
    const exchangeDecryptionSuccess = diagnostics.exchangeDecryptionSuccess === true;
    const exchangeSuccessful = exchangeUsable || exchangeDecryptionSuccess;

    // DECISION NORMALIZATION: Always ensure decision.reason is defined and clean
    if (diagnostics.decision) {
      normalized.decision = {
        action: diagnostics.decision.action || 'SKIP',
        reason: diagnostics.decision.reason || 'NO_REASON_PROVIDED'
      };

      // CRITICAL: If exchange is successful, remove ALL exchange error references
      if (exchangeSuccessful && normalized.decision.reason) {
        const reason = normalized.decision.reason;
        if (reason.includes('Exchange keys are invalid') ||
            reason.includes('encryption secret change') ||
            reason.includes('EXCHANGE_CREDENTIALS_DECRYPT_FAILED') ||
            reason.includes('EXCHANGE_ERROR') ||
            reason.includes('EXCHANGE_CORRUPTED') ||
            reason.includes('EXCHANGE_NOT_USABLE') ||
            reason.includes('NO_EXCHANGE_CREDENTIALS')) {
          
          // Replace with clean reason based on action
          normalized.decision.reason = normalized.decision.action === 'SKIP' ? 'SKIPPED' : normalized.decision.action;
          
          logger.info({
            agentId,
            originalReason: reason,
            newReason: normalized.decision.reason,
            exchangeUsable,
            exchangeDecryptionSuccess
          }, 'NORMALIZATION: Cleared stale exchange error from decision.reason');
        }
      }
    } else {
      // Ensure decision always exists
      normalized.decision = { action: 'SKIP', reason: 'NO_DECISION_PROVIDED' };
    }

    // EXECUTION NORMALIZATION: Clean execution object
    if (diagnostics.execution && normalized.executionStatus !== 'SKIPPED') {
      normalized.execution = {
        success: diagnostics.execution.success || false,
        orderId: diagnostics.execution.orderId || undefined,
        error: diagnostics.execution.error || undefined
      };

      // CRITICAL: If exchange is successful, remove exchangeErrorReason entirely
      if (exchangeSuccessful) {
        // Do NOT include exchangeErrorReason when exchange is usable
        delete normalized.execution.exchangeErrorReason;
        delete normalized.execution.exchangeError;
        
        logger.debug({
          agentId,
          exchangeUsable,
          exchangeDecryptionSuccess
        }, 'NORMALIZATION: Removed execution.exchangeErrorReason due to successful exchange state');
      } else {
        // Only include exchangeErrorReason if exchange is NOT usable
        normalized.execution.exchangeErrorReason = diagnostics.execution.exchangeErrorReason || undefined;
        normalized.execution.exchangeError = diagnostics.execution.exchangeError || undefined;
      }

      // Remove undefined fields from execution
      Object.keys(normalized.execution).forEach(key => {
        if (normalized.execution[key] === undefined) {
          delete normalized.execution[key];
        }
      });
    }

    // FAILURE NORMALIZATION: Clean failure object
    if (diagnostics.failure) {
      normalized.failure = {
        reasonCode: diagnostics.failure.reasonCode || undefined,
        reasonText: diagnostics.failure.reasonText || undefined,
        category: diagnostics.failure.category || undefined
      };

      // CRITICAL: If exchange is successful, remove exchange-related failures
      if (exchangeSuccessful && normalized.failure.reasonText) {
        const reasonText = normalized.failure.reasonText;
        if (reasonText.includes('Exchange keys are invalid') ||
            reasonText.includes('encryption secret change') ||
            reasonText.includes('EXCHANGE_CREDENTIALS_DECRYPT_FAILED') ||
            reasonText.includes('EXCHANGE_ERROR') ||
            reasonText.includes('EXCHANGE_CORRUPTED')) {
          
          // Clear the entire failure object when exchange is successful
          delete normalized.failure;
          
          logger.info({
            agentId,
            originalFailureText: reasonText,
            exchangeUsable,
            exchangeDecryptionSuccess
          }, 'NORMALIZATION: Cleared stale exchange failure due to successful exchange state');
        }
      }

      // Remove undefined fields from failure
      if (normalized.failure) {
        Object.keys(normalized.failure).forEach(key => {
          if (normalized.failure[key] === undefined) {
            delete normalized.failure[key];
          }
        });
        
        // Remove failure object if it's empty
        if (Object.keys(normalized.failure).length === 0) {
          delete normalized.failure;
        }
      }
    }

    // Copy other safe fields
    if (diagnostics.tradingPair) normalized.tradingPair = diagnostics.tradingPair;
    if (diagnostics.timestamp) normalized.timestamp = diagnostics.timestamp;
    if (diagnostics.agentId) normalized.agentId = diagnostics.agentId;

    // Copy signal data for non-skipped cycles
    if (diagnostics.signal && normalized.executionStatus !== 'SKIPPED') {
      normalized.signal = {
        direction: diagnostics.signal.direction || undefined,
        entryPrice: diagnostics.signal.entryPrice || undefined,
        stopLoss: diagnostics.signal.stopLoss || undefined,
        takeProfit: diagnostics.signal.takeProfit || undefined,
        rrRatio: diagnostics.signal.rrRatio || undefined
      };

      // Remove undefined fields from signal
      Object.keys(normalized.signal).forEach(key => {
        if (normalized.signal[key] === undefined) {
          delete normalized.signal[key];
        }
      });
    }

    // FINAL CLEANUP: Remove any remaining undefined fields at top level
    Object.keys(normalized).forEach(key => {
      if (normalized[key] === undefined) {
        delete normalized[key];
      }
    });

    return normalized;
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

        // CRITICAL: Log HTF agents specifically to verify they're loaded
        const isHTFAgent = config.strategyType === 'HTF_TREND_FILTER' || 
                          (config.name && config.name.includes('HTF Trend Filter'));
        
        // Log BB-RSI EMA200 Scalper agents
        const isBBRsiAgent = config.strategyType === 'MEAN_REVERSION_SCALPER' ||
                             (config.name && config.name.includes('BB-RSI'));
        
        const agentTypeLabel = isHTFAgent ? '🎯 HTF Trend Filter Agent' : 
                               isBBRsiAgent ? '📊 BB-RSI EMA200 Scalper Pro Agent' : 
                               'Trading agent';
        
        logger.info({
          agentId: config.id,
          name: config.name,
          tradingPair: config.tradingPair,
          strategyType: config.strategyType,
          isHTFAgent,
          isBBRsiAgent
        }, `${agentTypeLabel} loaded and activated`);
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
    // Log all agents being executed
    const agents = Array.from(this.activeAgents.values());
    logger.info({
      totalAgents: agents.length,
      agentIds: agents.map(a => a['config'].id),
      agentNames: agents.map(a => a['config'].name),
      strategyTypes: agents.map(a => a['config'].strategyType || 'UNKNOWN')
    }, 'Executing all active trading agents');

    // Execute all trading agents - HTF agents MUST execute if agent.status === "ACTIVE"
    const tradingAgentPromises = [];
    
    for (const agent of this.activeAgents.values()) {
      const agentConfig = agent['config'];
      const isHTFAgent = agentConfig.strategyType === 'HTF_TREND_FILTER' || 
                         (agentConfig.name && agentConfig.name.includes('HTF Trend Filter'));
      
      // Check agent status - only execute if ACTIVE
      if (agentConfig.status !== 'ACTIVE') {
        logger.debug({
          agentId: agentConfig.id,
          name: agentConfig.name,
          status: agentConfig.status,
          isHTFAgent
        }, 'Agent not RUNNING - skipping execution');
        continue;
      }
      
      if (isHTFAgent) {
        logger.info({
          agentId: agentConfig.id,
          name: agentConfig.name,
          strategyType: agentConfig.strategyType,
          status: agentConfig.status
        }, ' Executing HTF Trend Filter Agent - status=ACTIVE');
      }
      
      tradingAgentPromises.push(this.executeAgent(agent));
    }

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
    console.error("[EXECUTE_AGENT_ENTRY]", "uid=", agent['config']?.userId, "agentId=", agent['config']?.id, "time=", new Date().toISOString());
    const agentId = agent['config'].id;
    const agentConfig = agent['config'];
    const tradingPair = agentConfig.tradingPair;

    const normalizeSymbol = (value: string) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

    // Get symbol early for use throughout the function
    const symbol = normalizeSymbol(tradingPair);

    // Pair key used for all pair checks and per-pair persistence keys
    const pairKey = symbol;

    // Check if this is an HTF Trend Filter agent early for proper scoping
    const isHTFAgent = (agentConfig as any).strategyType === 'HTF_TREND_FILTER' || 
                       (agentConfig.name && agentConfig.name.includes('HTF Trend Filter'));

    // Check if this is a BB-RSI EMA200 Scalper agent
    const isBBRsiAgent = (agentConfig as any).strategyType === 'MEAN_REVERSION_SCALPER' ||
                         (agentConfig.name && agentConfig.name.includes('BB-RSI'));

    // PART A FIX: HTF bias direction tracking - NEVER overwrite once set
    let htfBiasDirection: 'LONG' | 'SHORT' | 'NO_TRADE' | null = null;

    // FIX PART 2 — SAFE DECISION INITIALIZATION
    // Initialize fresh diagnostics for this cycle only - NO reuse of previous cycle data
    // SAFE DECISION INITIALIZATION: Default to SKIP with NO_SIGNAL, never EXCHANGE_ERROR
    const diagnostics: any = {
      timestamp: new Date(),
      agentId,
      // HTF Agent execution fix: Do NOT attach tradingPair unless conditions are met
      sessionCheck: {},
      candleCheck: {},
      indicators: {},
      supportResistance: { calculated: false },
      signal: { direction: null, meetsConditions: false },
      riskAnalysis: {},
      srValidation: {},
      decision: { action: 'SKIP', reason: 'NO_SIGNAL' }, // SAFE DEFAULT: NO_SIGNAL, not EXCHANGE_ERROR
      // HARD RESET: Force clear all previous cycle state
      lastErrorReason: null,
      lastDecision: null,
      lastSignal: null,
      executionStateReset: true,
      cycleId: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, // Unique cycle ID
      direction: 'NO_TRADE' // Default direction
    };

    // PART A FIX: For HTF agents, calculate HTF bias direction EARLY and preserve it
    if (isHTFAgent) {
      try {
        // Try to get HTF trend direction early for consistent display
        const { HTFTrendFilterStrategy } = await import('./htfTrendFilterStrategy');
        const candles15m = await this.marketDataProvider.getCandles(symbol, '15m', 250);
        if (candles15m && candles15m.length >= 200) {
          candles15m.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
          const htfTrend = HTFTrendFilterStrategy.analyzeHTFTrend(candles15m);
          // PART A FIX: Set htfBiasDirection as soon as HTF trend is known
          if (htfTrend.direction === 'LONG_ONLY') {
            htfBiasDirection = 'LONG';
          } else if (htfTrend.direction === 'SHORT_ONLY') {
            htfBiasDirection = 'SHORT';
          } else {
            htfBiasDirection = 'NO_TRADE';
          }
          // CRITICAL: Set direction ONCE and NEVER change it
          diagnostics.direction = htfBiasDirection;
          logger.debug({
            agentId,
            htfDirection: htfBiasDirection,
            htfTrendDirection: htfTrend.direction
          }, 'HTF Agent: Early HTF bias direction calculated and set');
        }
      } catch (error) {
        logger.warn({
          agentId,
          error: error instanceof Error ? error.message : 'Unknown error'
        }, 'HTF Agent: Failed to calculate early HTF bias direction');
        htfBiasDirection = 'NO_TRADE';
      }
    }

    // FIX PART A — HARD RESET EXECUTION STATE
    // At the START of EVERY cycle: Force reset execution state
    // Do NOT reuse any previous cycle data
    if (isHTFAgent) {
      logger.debug({
        agentId,
        name: agentConfig.name,
        tradingPair,
        strategyType: (agentConfig as any).strategyType
      }, ' HTF AGENT EXECUTION STARTED - HARD RESET execution state');
      
      // Force reset all previous cycle data
      // lastErrorReason, lastDecision, lastSignal - all cleared
      // This prevents reusing stale state from previous cycles
    }

    // Initialize tracking variables for this cycle only - NEVER reuse previous values
    let exchangeUsable = false;
    let marketScanExecuted = false;
    let signalGenerated = false;
    let skippedReason: string | null = null;
    let agentExecutionRan = false; // Track if agent logic actually executed
    let htfMarketDataSkip: { reasonCode: string; reasonText: string } | null = null;

    // INTERNAL HELPER: Single source for skip finalization - THE ONLY SKIP WRITER
    const finalizeSkip = (reasonCode: string, reasonText: string, category: 'SESSION' | 'EXCHANGE' | 'DATA' | 'RISK' | 'SIGNAL') => {
      diagnostics.decision = { action: 'SKIP', reason: reasonText };
      diagnostics.failure = {
        reasonCode,
        reasonText,
        category
      };
      diagnostics.tradingPair = tradingPair;
    };

    try {
      // CRITICAL: Check if agent was manually stopped by user
      // Manual STOP must override everything - do NOT run any logic
      const currentAgentConfig = await firestoreAdapter.getTradingAgentConfig(agentId);
      if (!currentAgentConfig || currentAgentConfig.status === 'STOPPED') {
        skippedReason = 'AGENT_STOPPED';
        finalizeSkip('AGENT_STOPPED', 'Agent was manually stopped by user', 'SESSION');
        
        if (isHTFAgent) {
          logger.info({
            agentId,
            tradingPair
          }, `[HTF_AGENT] usable=${exchangeUsable}, scanExecuted=${marketScanExecuted}, signalGenerated=${signalGenerated}, skippedReason=${skippedReason}`);
        }
        
        logger.debug({
          agentId,
          userId: agentConfig.userId,
          status: currentAgentConfig?.status || 'NOT_FOUND'
        }, 'Trading Agent is STOPPED - skipping execution cycle');
        
        return;
      }

      // Also check for PAUSED status
      if (currentAgentConfig.status === 'PAUSED') {
        skippedReason = 'AGENT_PAUSED';
        finalizeSkip('AGENT_PAUSED', 'Agent was manually paused by user', 'SESSION');

        if (isHTFAgent) {
          logger.info({
            agentId,
            tradingPair
          }, `[HTF_AGENT] usable=${exchangeUsable}, scanExecuted=${marketScanExecuted}, signalGenerated=${signalGenerated}, skippedReason=${skippedReason}`);
        }

        logger.debug({ agentId }, 'Trading Agent is PAUSED - skipping execution cycle');
        return;
      }

      // HTF agents are COMPLETELY STANDALONE and execute when agent status is ACTIVE
      // They do NOT depend on global auto-trade or telegram modes
      if (isHTFAgent) {
        logger.debug({
          agentId,
          uid: agentConfig.userId,
          status: agentConfig.status
        }, 'HTF Agent: STANDALONE execution - bypassing all global mode checks');
      }

      // Create agent-specific market provider using canonical exchange config
      const exchangeConfig = await firestoreAdapter.getExchangeConfig(agentConfig.userId);
      if (!exchangeConfig?.exchange) {
        skippedReason = 'NO_EXCHANGE_CONFIG_FOUND';
        finalizeSkip('NO_EXCHANGE_CONFIG_FOUND', 'No exchange connected. Please connect your exchange in Settings → Exchange to enable trading.', 'EXCHANGE');

        if (isHTFAgent) {
          logger.info({
            agentId,
            tradingPair
          }, `[HTF_AGENT] usable=${exchangeUsable}, scanExecuted=${marketScanExecuted}, signalGenerated=${signalGenerated}, skippedReason=${skippedReason}`);
        }

        logger.warn({
          agentId,
          uid: agentConfig.userId,
          exchangeConfigPath: `users/${agentConfig.userId}/exchangeConfig/current`
        }, 'SKIP: NO_EXCHANGE_CONFIG_FOUND - user must connect exchange in Settings');

        return;
      }

      // CHECK: If encryption secret has changed, mark exchange as requiring reconnection
      if (exchangeConfig.encryptionInvalid === true) {
        skippedReason = 'EXCHANGE_ENCRYPTION_INVALID';
        finalizeSkip('EXCHANGE_ENCRYPTION_INVALID', 'Exchange keys are invalid due to encryption secret change. Please reconnect exchange.', 'EXCHANGE');

        if (isHTFAgent) {
          logger.info({
            agentId,
            tradingPair
          }, `[HTF_AGENT] usable=${exchangeUsable}, scanExecuted=${marketScanExecuted}, signalGenerated=${signalGenerated}, skippedReason=${skippedReason}`);
        }

        logger.warn({
          agentId,
          uid: agentConfig.userId,
          exchange: exchangeConfig.exchange,
          error: exchangeConfig.lastValidationError
        }, 'SKIP: Exchange encryption invalid - user must reconnect exchange');

        return;
      }

      // NOTE: Do NOT hard-skip when exchangeStatus === 'CORRUPTED'.
      // Decryption success is authoritative; if keys cannot decrypt (e.g. ENCRYPTION_SECRET_CHANGED), we'll skip in the decrypt catch below.

      // FIX PART B — EXCHANGE ERROR TRUTH SOURCE
      // Use isExchangeUsable() as single source of truth - this properly handles decryption and caching
      const exchangeUsabilityResult = await isExchangeUsable(agentConfig.userId, 'background_job');
      exchangeUsable = exchangeUsabilityResult.usable;
      
      if (isHTFAgent) {
        if (exchangeUsable) {
          // If isExchangeUsable().usable === true: NEVER allow EXCHANGE_ERROR or EXCHANGE_CREDENTIALS_DECRYPT_FAILED
          // Force-clear error state before proceeding - UI/diagnostics must reflect ONLY current cycle result
          logger.debug({
            agentId,
            exchange: exchangeConfig.exchange,
            isUsable: true,
            reason: exchangeUsabilityResult.reason
          }, 'HTF Agent: Exchange is usable - FORCE clearing all previous EXCHANGE_ERROR and EXCHANGE_CREDENTIALS_DECRYPT_FAILED states');
          
          // Clear any cached error states in diagnostics - not stored Firestore history
          diagnostics.exchangeErrorCleared = true;
          diagnostics.exchangeUsable = true;
          diagnostics.previousErrorsCleared = ['EXCHANGE_ERROR', 'EXCHANGE_CREDENTIALS_DECRYPT_FAILED'];
        } else {
          logger.debug({
            agentId,
            exchange: exchangeConfig.exchange,
            isUsable: false,
            reason: exchangeUsabilityResult.reason
          }, 'HTF Agent: Exchange not usable - will skip with appropriate reason');
        }
      }

      const encryptedApiKey = exchangeConfig.apiKeyEncrypted;
      const encryptedSecret = exchangeConfig.secretKeyEncrypted || exchangeConfig.secretEncrypted;
      const encryptedPassphrase = exchangeConfig.passphraseEncrypted;

      if (!encryptedApiKey || !encryptedSecret) {
        skippedReason = 'NO_EXCHANGE_CREDENTIALS';
        finalizeSkip('NO_EXCHANGE_CREDENTIALS', 'Exchange credentials not found. Please connect your exchange in Settings → Exchange.', 'EXCHANGE');
        
        if (isHTFAgent) {
          logger.info({
            agentId,
            tradingPair
          }, `[HTF_AGENT] usable=${exchangeUsable}, scanExecuted=${marketScanExecuted}, signalGenerated=${signalGenerated}, skippedReason=${skippedReason}`);
        }
        
        logger.warn({ 
          agentId, 
          uid: agentConfig.userId, 
          exchange: exchangeConfig.exchange,
          hasApiKey: !!encryptedApiKey,
          hasSecret: !!encryptedSecret,
          exchangeUsable
        }, `SKIP: ${skippedReason} - encrypted keys missing`);
        
        return;
      }

      let apiKey: string | null = null;
      let secret: string | null = null;
      let passphrase: string | undefined = undefined;

      try {
        apiKey = encryptedApiKey ? decrypt(encryptedApiKey, 'exchange') : null;
        secret = encryptedSecret ? decrypt(encryptedSecret, 'exchange') : null;
        passphrase = encryptedPassphrase ? decrypt(encryptedPassphrase, 'exchange') : undefined;
      } catch (decryptError: any) {
        // Handle ENCRYPTION_SECRET_CHANGED error specifically
        if (decryptError.message?.includes('ENCRYPTION_SECRET_CHANGED')) {
          skippedReason = 'EXCHANGE_CORRUPTED';
          finalizeSkip('EXCHANGE_CORRUPTED', 'Exchange keys are invalid due to encryption secret change. Please reconnect exchange.', 'EXCHANGE');
          
          // NOTE: Do NOT attempt to mark exchange as corrupted in Firestore
          // Exchange status is managed exclusively by /exchange/connect
          logger.warn({ agentId, uid: agentConfig.userId }, 'ENCRYPTION_SECRET_CHANGED detected - soft skipping cycle without Firestore update');
          
          if (isHTFAgent) {
            logger.info({
              agentId,
              tradingPair
            }, `[HTF_AGENT] usable=${exchangeUsable}, scanExecuted=${marketScanExecuted}, signalGenerated=${signalGenerated}, skippedReason=${skippedReason}`);
          }
          
          logger.error({ 
            agentId, 
            uid: agentConfig.userId, 
            exchange: exchangeConfig.exchange,
            error: decryptError.message
          }, `SKIP: ${skippedReason} - encryption secret has changed, exchange marked as corrupted`);
          
          return;
        }
        
        // Handle other decryption errors
        skippedReason = 'EXCHANGE_KEYS_NOT_DECRYPTED';
        finalizeSkip('EXCHANGE_KEYS_NOT_DECRYPTED', 'Failed to decrypt exchange keys', 'EXCHANGE');
        
        if (isHTFAgent) {
          logger.info({
            agentId,
            tradingPair
          }, `[HTF_AGENT] usable=${exchangeUsable}, scanExecuted=${marketScanExecuted}, signalGenerated=${signalGenerated}, skippedReason=${skippedReason}`);
        }
        
        logger.error({ 
          agentId, 
          uid: agentConfig.userId, 
          exchange: exchangeConfig.exchange,
          error: decryptError.message
        }, `SKIP: ${skippedReason} - decryption failed`);
        
        return;
      }

      // EXECUTION GUARD: Assert keys are not null before proceeding
      if (!apiKey || !secret) {
        skippedReason = 'EXCHANGE_KEYS_NOT_DECRYPTED';
        finalizeSkip('EXCHANGE_KEYS_NOT_DECRYPTED', 'EXCHANGE_KEYS_NOT_DECRYPTED', 'EXCHANGE');
        
        // CRITICAL: Log detailed information to diagnose decrypt failure
        const encryptionKeyStatus = (() => {
          try {
            const { getEncryptionKeyStatus } = require('./keyManager');
            return getEncryptionKeyStatus();
          } catch {
            return { initialized: false, keyLength: 0, keyHash: 'unknown', cached: false };
          }
        })();
        
        if (isHTFAgent) {
          logger.info({
            agentId,
            tradingPair
          }, `[HTF_AGENT] usable=${exchangeUsable}, scanExecuted=${marketScanExecuted}, signalGenerated=${signalGenerated}, skippedReason=${skippedReason}`);
        }
        
        logger.error({ 
          agentId, 
          uid: agentConfig.userId, 
          exchange: exchangeConfig.exchange,
          exchangeUsable,
          decryptedApiKey: !!apiKey,
          decryptedSecret: !!secret,
          hasEncryptedApiKey: !!encryptedApiKey,
          hasEncryptedSecret: !!encryptedSecret,
          encryptedApiKeyLength: encryptedApiKey?.length || 0,
          encryptedSecretLength: encryptedSecret?.length || 0,
          encryptedApiKeyFormat: encryptedApiKey?.includes(':') ? 'valid' : 'invalid',
          encryptedSecretFormat: encryptedSecret?.includes(':') ? 'valid' : 'invalid',
          encryptionKeyStatus
        }, `SKIP: ${skippedReason} - decryption failed. User needs to reconnect exchange.`);
        
        return;
      }

      // CRITICAL: When decryption succeeds, explicitly clear ALL previous exchange error states
      // This prevents stale "Exchange keys are invalid due to encryption secret change" errors
      // from persisting after successful decryption
      if (apiKey && secret) {
        // Clear any cached exchange failure flags or memory state
        diagnostics.exchangeDecryptionSuccess = true;
        diagnostics.exchangeUsable = true;
        diagnostics.previousExchangeErrorsCleared = true;
        
        // CRITICAL FIX: Clear any stale error message from previous failed cycles
        // This ensures diagnostics.decision.reason reflects CURRENT cycle state only
        if (diagnostics.decision && diagnostics.decision.reason && 
            (diagnostics.decision.reason.includes('encryption secret change') || 
             diagnostics.decision.reason.includes('Exchange keys are invalid'))) {
          // Reset decision to reflect successful exchange state
          diagnostics.decision = { action: 'CONTINUE', reason: 'Exchange credentials successfully decrypted and validated' };
          diagnostics.failure = null; // Clear any previous failure state
          
          logger.info({
            agentId,
            uid: agentConfig.userId,
            exchange: exchangeConfig.exchange,
            previousErrorCleared: true
          }, 'STALE_ERROR_CLEARED: Removed previous exchange error message after successful decryption');
        }
        
        logger.debug({
          agentId,
          uid: agentConfig.userId,
          exchange: exchangeConfig.exchange,
          credentialsResolved: true,
          exchangeUsable: true
        }, 'Trading Agent credentials successfully resolved - clearing all previous exchange error states');
      }

      const exchangeCredentials: ExchangeCredentials = {
        apiKey,
        secret,
        passphrase,
        testnet: exchangeConfig.testnet ?? false,
      };

      // Normalize exchange name to lowercase
      const normalizedExchange = String(exchangeConfig.exchange || agentConfig.exchange).toLowerCase();
      const marketProvider = new TradingAgentMarketProvider(exchangeCredentials, normalizedExchange as any, 'futures');

      // SINGLE SOURCE OF TRUTH: If keys decrypt successfully (and user didn't disconnect), exchange is usable.
      exchangeUsable = exchangeConfig.disconnected !== true && !!apiKey && !!secret && (normalizedExchange !== 'bitget' || !!passphrase);

      if (!exchangeUsable) {
        skippedReason = 'EXCHANGE_NOT_USABLE';
        finalizeSkip('EXCHANGE_NOT_USABLE', normalizedExchange === 'bitget' && !passphrase
          ? 'Bitget passphrase missing or failed to decrypt'
          : 'Exchange connection is not usable - check credentials and connection', 'EXCHANGE');
        return;
      }

      // CRITICAL: HTF agents can ONLY trade BTC/USDT and ETH/USDT
      if (isHTFAgent) {
        const allowedSymbols = ['BTCUSDT', 'ETHUSDT'];
        if (!allowedSymbols.includes(symbol)) {
          skippedReason = `HTF agents restricted to BTC/USDT, ETH/USDT only`;
          finalizeSkip('PAIR_RESTRICTION', `HTF Trend Filter agents are restricted to BTC/USDT, ETH/USDT only. Current pair: ${tradingPair}`, 'RISK');
          
          logger.info({
            agentId,
            tradingPair
          }, `[HTF_AGENT] usable=${exchangeUsable}, scanExecuted=${marketScanExecuted}, signalGenerated=${signalGenerated}, skippedReason=${skippedReason}`);
          
          logger.warn({
            agentId,
            tradingPair,
            allowedSymbols
          }, 'HTF Trend Filter: Trading pair not allowed');
          return;
        }
      }

      // CRITICAL: BB-RSI agents can trade BTC, ETH, SOL, BNB, XRP ONLY
      if (isBBRsiAgent) {
        const allowedSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
        if (!allowedSymbols.includes(symbol)) {
          skippedReason = `BB-RSI agents restricted to BTC/USDT, ETH/USDT, SOL/USDT, BNB/USDT, XRP/USDT only`;
          finalizeSkip('PAIR_RESTRICTION', `BB-RSI EMA200 Scalper agents are restricted to: BTC/USDT, ETH/USDT, SOL/USDT, BNB/USDT, XRP/USDT. Current pair: ${tradingPair}`, 'RISK');
          
          logger.warn({
            agentId,
            tradingPair,
            allowedSymbols
          }, 'BB-RSI Scalper: Trading pair not allowed');
          return;
        }
      }
      
      let candles: any[] = [];
      let candles15m: any[] = [];
      
      if (isHTFAgent) {
        // FIX PART C — BAN FALLBACK SIGNALS (CRITICAL)
        // If ANY of these is true: market data fetch failed, candle data empty, indicator calc skipped, scanExecuted === false
        // THEN: DO NOT generate signal, DO NOT default to BTC/USDT, DO NOT reuse previous signal
        try {
          // Fetch 15m candles for HTF trend analysis (need 200+ for EMA 200)
          candles15m = await marketProvider.getCandles(symbol, '15m', 250);
          
          // Fetch 1m candles for LTF entry signals (need 200+ for indicators)
          candles = await marketProvider.getCandles(symbol, '1m', 250);
          
          // FIX PART C — BAN FALLBACK SIGNALS (CRITICAL)
          // Validate candle data is not empty - CRITICAL CHECK
          if (!candles15m || candles15m.length === 0 || !candles || candles.length === 0) {
            skippedReason = 'MARKET_DATA_NOT_READY';
            finalizeSkip('MARKET_DATA_NOT_READY', 'Candle data empty - market data not available', 'DATA');
            
            logger.info({
              agentId,
              tradingPair
            }, `[HTF_AGENT] usable=${exchangeUsable}, scanExecuted=${marketScanExecuted}, signalGenerated=${signalGenerated}, skippedReason=${skippedReason}`);
            
            logger.error({
              agentId,
              candles15mCount: candles15m?.length || 0,
              candles1mCount: candles?.length || 0
            }, 'HTF Trend Filter: Candle data empty - BANNED fallback signals, NO default BTC/USDT, NO reuse previous signal');
            return;
          }
          
          if (candles15m.length < 200) {
            htfMarketDataSkip = {
              reasonCode: 'MARKET_DATA_NOT_READY',
              reasonText: `Insufficient 15m candle data: ${candles15m.length}/200 required`
            };
          } else if (candles.length < 200) {
            htfMarketDataSkip = {
              reasonCode: 'MARKET_DATA_NOT_READY',
              reasonText: `Insufficient 1m candle data: ${candles.length}/200 required`
            };
          }

          // Sort candles (most recent first)
          candles15m.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
          candles.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
          
          // Mark that market scan was successfully executed - CRITICAL for signal generation
          marketScanExecuted = !htfMarketDataSkip;
          
        } catch (marketDataError) {
          // FIX PART C — BAN FALLBACK SIGNALS (CRITICAL)
          // If market data fetch failed - DO NOT generate signal, DO NOT default to BTC/USDT, DO NOT reuse previous signal
          // Mark cycle as SKIPPED with reason = MARKET_DATA_NOT_READY
          skippedReason = 'MARKET_DATA_NOT_READY';
          finalizeSkip('MARKET_DATA_NOT_READY', marketDataError instanceof Error ? marketDataError.message : 'Market data fetch failed', 'DATA');
          
          logger.info({
            agentId,
            tradingPair
          }, `[HTF_AGENT] usable=${exchangeUsable}, scanExecuted=${marketScanExecuted}, signalGenerated=${signalGenerated}, skippedReason=${skippedReason}`);
          
          logger.error({
            agentId,
            error: marketDataError instanceof Error ? marketDataError.message : 'Unknown error'
          }, 'HTF Trend Filter: Market scan failed - BANNED fallback signals, NO default BTC/USDT, NO reuse previous signal');
          return;
        }
      } else if (isBBRsiAgent) {
        // BB-RSI Scalper uses 3m primary + 5m confirmation
        try {
          // Fetch 3m candles for primary signal (need 250+ for BB/RSI/EMA200)
          candles = await marketProvider.getCandles(symbol, '3m', 250);
          
          // Fetch 5m candles for confirmation (need 250+ for BB/RSI/EMA200)
          candles15m = await marketProvider.getCandles(symbol, '5m', 250);
          
          if (!candles || candles.length === 0 || !candles15m || candles15m.length === 0) {
            skippedReason = 'MARKET_DATA_NOT_READY';
            finalizeSkip('MARKET_DATA_NOT_READY', 'Candle data empty - market data not available', 'DATA');
            
            logger.warn({
              agentId,
              candles3mCount: candles?.length || 0,
              candles5mCount: candles15m?.length || 0
            }, 'BB-RSI Scalper: Candle data empty');
            
            return;
          }
          
          if (candles.length < 250) {
            htfMarketDataSkip = {
              reasonCode: 'MARKET_DATA_NOT_READY',
              reasonText: `Insufficient 3m candle data: ${candles.length}/250 required`
            };
          } else if (candles15m.length < 250) {
            htfMarketDataSkip = {
              reasonCode: 'MARKET_DATA_NOT_READY',
              reasonText: `Insufficient 5m candle data: ${candles15m.length}/250 required`
            };
          }

          // Sort candles (most recent first)
          candles.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
          candles15m.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
          
          // Mark that market scan was successfully executed
          marketScanExecuted = !htfMarketDataSkip;
          
        } catch (marketDataError) {
          skippedReason = 'MARKET_DATA_NOT_READY';
          finalizeSkip('MARKET_DATA_NOT_READY', marketDataError instanceof Error ? marketDataError.message : 'Market data fetch failed', 'DATA');
          
          logger.error({
            agentId,
            error: marketDataError instanceof Error ? marketDataError.message : 'Unknown error'
          }, 'BB-RSI Scalper: Market scan failed');
          
          return;
        }
      } else {
        // Regular agents use 5m candles
        candles = await marketProvider.getCandles(
          symbol,
          '5m',
          50 // Need enough candles for indicator calculation
        );
        
        if (candles.length < 50) {
          finalizeSkip('MARKET_DATA_NOT_READY', `Insufficient 5m candles: ${candles.length}/50`, 'DATA');
          logger.warn({
            agentId,
            candlesCount: candles.length
          }, 'Insufficient candle data for agent execution');
          return;
        }
        
        // IMPORTANT: Our indicator library expects candles in "most recent first" order.
        // Many exchanges return klines oldest->newest.
        candles.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
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

      // ===== OPEN TRADE MANAGEMENT (SL/TP) =====
      // If there's an open position for this agent+pair, manage exits first.
      try {
        const recentAgentTrades = await firestoreAdapter.getAgentTrades(agentId, 25);
        const openTradesForPair = (recentAgentTrades || []).filter((t: any) => {
          return t?.status === 'OPEN' && normalizeSymbol(t?.tradingPair) === pairKey;
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
          finalizeSkip('MANAGING_OPEN_POSITION', 'Managing existing open position - no new trades allowed', 'RISK');
          await firestoreAdapter.updateLastProcessedCandle(agentId, pairKey, candleTimestamp);
          return;
        }
      } catch (error) {
        // Non-fatal - continue with normal flow
      }

      // ===== CLOSED-CANDLE DETERMINISM =====
      // Check if this candle was already processed
      const lastProcessedCandle = await firestoreAdapter.getLastProcessedCandle(agentId, pairKey);
      if (lastProcessedCandle && candleTimestamp.getTime() === lastProcessedCandle.getTime()) {
        finalizeSkip('CANDLE_ALREADY_PROCESSED', 'This candle was already processed in a previous cycle', 'DATA');
        
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
        finalizeSkip('INVALID_INDICATORS', 'Technical indicators could not be calculated properly', 'DATA');
        logger.error({
          agentId,
          indicators
        }, 'Invalid indicators calculated');
        return;
      }

      // Generate trading signal with S/R validation
      let signal;
      
      if (isBBRsiAgent) {
        // BB-RSI EMA200 Scalper mean reversion strategy
        
        if (!marketScanExecuted) {
          skippedReason = htfMarketDataSkip?.reasonText || 'Market scan not executed';
          finalizeSkip(htfMarketDataSkip?.reasonCode || 'MARKET_SCAN_NOT_EXECUTED', htfMarketDataSkip?.reasonText || 'Market scan was not executed - preventing signal generation', 'DATA');
          
          logger.debug({
            agentId,
            tradingPair,
            reason: skippedReason
          }, 'BB-RSI Scalper: Market scan not executed');
          
          // Update last processed candle even with no signal
          await firestoreAdapter.updateLastProcessedCandle(agentId, pairKey, candleTimestamp);
          return;
        }

        // Get account balance for position sizing
        try {
          const accountInfo = await marketProvider.getAccountBalance();
          const accountBalance = accountInfo?.equity || 10000; // Default to 10k if unavailable

          // Generate BB-RSI mean reversion signal
          const bbRsiSignal = BBRsiEma200ScalperStrategy.generateSignal(candles, accountBalance);
          
          diagnostics.signal = bbRsiSignal;
          diagnostics.tradeSetup = bbRsiSignal.tradeSetup;
          
          if (!bbRsiSignal.isValid) {
            skippedReason = bbRsiSignal.reason;
            finalizeSkip('NO_MEAN_REVERSION_SIGNAL', bbRsiSignal.reason || 'No mean reversion setup detected', 'SIGNAL');
            
            logger.debug({
              agentId,
              tradingPair,
              reason: bbRsiSignal.reason,
              indicators: bbRsiSignal.indicators
            }, 'BB-RSI Scalper: No valid signal');
            
            // Update last processed candle
            await firestoreAdapter.updateLastProcessedCandle(agentId, pairKey, candleTimestamp);
            return;
          }

          // Valid signal - continue with execution
          signal = {
            direction: bbRsiSignal.direction,
            entryPrice: bbRsiSignal.entryPrice,
            stopLoss: bbRsiSignal.stopLoss,
            takeProfit: bbRsiSignal.takeProfit2, // Use TP2 as primary target
            takeProfit1: bbRsiSignal.takeProfit1, // Intermediate TP
            confidence: bbRsiSignal.confidence,
            reason: bbRsiSignal.reason
          };
          
          signalGenerated = true;
          agentExecutionRan = true;
          
          logger.info({
            agentId,
            tradingPair,
            signal: signal.direction,
            entryPrice: signal.entryPrice,
            stopLoss: signal.stopLoss,
            tp1: signal.takeProfit1,
            tp2: signal.takeProfit,
            confidence: signal.confidence
          }, 'BB-RSI Scalper: Valid mean reversion signal generated');
          
        } catch (error) {
          skippedReason = 'BB_RSI_SIGNAL_ERROR';
          finalizeSkip('BB_RSI_SIGNAL_ERROR', error instanceof Error ? error.message : 'Error generating BB-RSI signal', 'SIGNAL');
          
          logger.error({
            agentId,
            error: error instanceof Error ? error.message : 'Unknown error'
          }, 'BB-RSI Scalper: Signal generation failed');
          
          await firestoreAdapter.updateLastProcessedCandle(agentId, pairKey, candleTimestamp);
          return;
        }
      } else if (isHTFAgent) {
        // FIX PART D — REQUIRE REAL DATA CONFIRMATION
        // HTF agent may generate signal ONLY if ALL true:
        // - exchange usable, marketScanExecuted === true, indicators evaluated (EMA / RSI / HTF trend), result is not NO_TRADE
        // Else → SKIP
        
        if (!marketScanExecuted) {
          skippedReason = htfMarketDataSkip?.reasonText || 'Market scan not executed';
          finalizeSkip(htfMarketDataSkip?.reasonCode || 'MARKET_SCAN_NOT_EXECUTED', htfMarketDataSkip?.reasonText || 'Market scan was not executed - preventing signal generation', 'DATA');
          
          logger.info({
            agentId,
            tradingPair
          }, `[HTF_AGENT] usable=${exchangeUsable}, scanExecuted=${marketScanExecuted}, signalGenerated=${signalGenerated}, skippedReason=${skippedReason}`);
          
          logger.warn({
            agentId
          }, 'HTF Trend Filter: Market scan not executed - preventing signal generation');
          
          // Update last processed candle even with no signal
          await firestoreAdapter.updateLastProcessedCandle(agentId, pairKey, candleTimestamp);
          return;
        }
        
        // exchangeUsable is guaranteed true here due to earlier gate
        
        // For HTF agents, analyze HTF trend first, then generate LTF signal
        const { HTFTrendFilterStrategy } = await import('./htfTrendFilterStrategy');
        
        const htfTrend = HTFTrendFilterStrategy.analyzeHTFTrend(candles15m);
        diagnostics.htfTrend = htfTrend;
        
        // LOGIC FIX (MANDATORY): If direction === NO_TRADE, do NOT start execution pipeline
        if (htfTrend.direction === 'NO_TRADE') {
          skippedReason = htfTrend.reason;
          finalizeSkip('HTF_CONDITION_NOT_MET', htfTrend.reason || 'HTF trend conditions not met - no trade opportunity', 'SIGNAL');
          
          logger.info({
            agentId,
            tradingPair
          }, `[HTF_AGENT] usable=${exchangeUsable}, scanExecuted=${marketScanExecuted}, signalGenerated=${signalGenerated}, skippedReason=${skippedReason}`);
          
          logger.debug({
            agentId,
            htfTrend
          }, 'HTF Trend Filter: No valid trend');
          
          // Update last processed candle even with no signal
          await firestoreAdapter.updateLastProcessedCandle(agentId, pairKey, candleTimestamp);
          return;
        }
        
        // Analyze LTF entry with HTF trend filter
        const ltfSignal = HTFTrendFilterStrategy.analyzeLTFEntry(candles, htfTrend.direction);
        diagnostics.ltfSignal = ltfSignal;
        
        if (!ltfSignal.isValid) {
          skippedReason = ltfSignal.reason;
          finalizeSkip('LTF_CONDITIONS_NOT_MET', ltfSignal.reason || 'LTF entry conditions not met despite valid HTF trend', 'SIGNAL');
          
          logger.info({
            agentId,
            tradingPair
          }, `[HTF_AGENT] usable=${exchangeUsable}, scanExecuted=${marketScanExecuted}, signalGenerated=${signalGenerated}, skippedReason=${skippedReason}`);
          
          logger.debug({
            agentId,
            ltfSignal
          }, 'HTF Trend Filter: LTF entry conditions not met');
          
          // Update last processed candle even with no signal
          await firestoreAdapter.updateLastProcessedCandle(agentId, pairKey, candleTimestamp);
          return;
        }
        
        // Convert LTF signal to TradingSignal format
        const createSignalId = (direction: 'LONG' | 'SHORT') => {
          const signalData = `${agentId}:${candleTimestamp.getTime()}:${direction}:${ltfSignal.entryPrice}`;
          let hash = 0;
          for (let i = 0; i < signalData.length; i++) {
            const char = signalData.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
          }
          return `htf_trend_filter_${Math.abs(hash).toString(36)}`;
        };
        
        // Calculate RR ratio for diagnostics
        const riskPerUnit = Math.abs(ltfSignal.entryPrice - ltfSignal.stopLoss);
        const rewardPerUnit = Math.abs(ltfSignal.takeProfit - ltfSignal.entryPrice);
        const calculatedRR = riskPerUnit > 0 ? rewardPerUnit / riskPerUnit : 0;
        
        signal = {
          signalId: createSignalId(ltfSignal.direction!),
          direction: ltfSignal.direction!,
          entryPrice: ltfSignal.entryPrice,
          stopLoss: ltfSignal.stopLoss,
          takeProfit: ltfSignal.takeProfit,
          calculatedRR,
          timestamp: new Date(),
          candleTimestamp: candleTimestamp,
          indicators: {
            rsi: ltfSignal.indicators.rsi,
            ema50: ltfSignal.indicators.ema50,
            bbUpper: ltfSignal.indicators.bbUpper,
            bbLower: ltfSignal.indicators.bbLower,
            atr: indicators.atr
          },
        };
        signalGenerated = true;
        
        // HTF Agent execution fix: ALWAYS attach tradingPair for diagnostics
        diagnostics.tradingPair = tradingPair;
        // CRITICAL: Direction was already set early - do NOT overwrite it here
      } else {
        // Regular agents use standard signal generation
        signal = agent.generateSignal(latestCandle, {
          rsi: indicators.rsi,
          ema50: indicators.ema50,
          bbUpper: indicators.bbUpper,
          bbLower: indicators.bbLower,
          atr: indicators.atr
        }, candles);
        
        // For regular agents, attach tradingPair if signal is generated
        if (signal) {
          diagnostics.tradingPair = tradingPair;
        }
      }

      if (!signal) {
        finalizeSkip('NO_SIGNAL', 'No trading signal generated - market conditions not met', 'SIGNAL');
        // CRITICAL: Add single diagnostic log line for HTF agents
        if (isHTFAgent) {
          logger.info({
            agentId,
            tradingPair
          }, `[HTF_AGENT] usable=${exchangeUsable}, scanExecuted=${marketScanExecuted}, signalGenerated=${signalGenerated}`);
        }

        logger.debug({
          agentId,
          indicators
        }, 'No trading signal generated');

        // Update last processed candle even with no signal
        await firestoreAdapter.updateLastProcessedCandle(agentId, pairKey, candleTimestamp);
        return;
      }

      // ===== EXECUTION IDEMPOTENCY =====
      // Check if this signal was already executed
      const signalAlreadyExecuted = await firestoreAdapter.isSignalExecuted(agentId, signal.signalId);
      if (signalAlreadyExecuted) {
        finalizeSkip('SIGNAL_ALREADY_EXECUTED', 'This signal was already executed in a previous cycle', 'RISK');
        logger.info({
          agentId,
          signalId: signal.signalId,
          reason: 'SIGNAL_IDEMPOTENCY'
        }, 'Execution blocked: signal already executed');

        // Update last processed candle
        await firestoreAdapter.updateLastProcessedCandle(agentId, pairKey, candleTimestamp);
        return;
      }

      // ===== DAILY SAFETY RULE ENFORCEMENT =====
      const dailyCounters = await firestoreAdapter.getDailySafetyCounters(agentId);

      // CRITICAL: HTF Trend Filter agents have STRICT HARD LIMITS that cannot be overridden
      // These limits are enforced regardless of agent config settings
      let maxTradesPerDay: number;
      let enforcedRiskPerTrade: number;
      let enforcedLeverage: number;
      
      if (isHTFAgent) {
        // HTF HARD LIMITS - CANNOT BE CHANGED
        maxTradesPerDay = 5; // Strict maximum: 5 trades per day
        enforcedRiskPerTrade = 0.01; // Strict risk: 1% per trade
        enforcedLeverage = 5; // Strict leverage: 5x
        
        logger.debug({
          agentId,
          maxTradesPerDay,
          riskPerTrade: enforcedRiskPerTrade,
          leverage: enforcedLeverage
        }, 'HTF Trend Filter Agent: Enforcing strict hard limits');
      } else {
        // Regular agents use config with cap
        maxTradesPerDay = Math.min(Number(agentConfig.maxTradesPerDay) || 5, 5);
        enforcedRiskPerTrade = Number(agentConfig.riskPerTrade) || 0.02;
        enforcedLeverage = Number(agentConfig.leverage) || 8;
      }

      // Check daily trade limit
      if (dailyCounters.tradesToday >= maxTradesPerDay) {
        finalizeSkip('DAILY_TRADE_LIMIT', `Daily trade limit reached: ${dailyCounters.tradesToday}/${maxTradesPerDay}`, 'RISK');
        logger.info({
          agentId,
          tradesToday: dailyCounters.tradesToday,
          maxTrades: maxTradesPerDay,
          reason: 'DAILY_TRADE_LIMIT'
        }, 'Execution blocked: daily trade limit reached');
        await firestoreAdapter.updateLastProcessedCandle(agentId, pairKey, candleTimestamp);
        return;
      }

      // Check consecutive losses limit
      if (dailyCounters.consecutiveLosses >= 2) {
        finalizeSkip('CONSECUTIVE_LOSSES_LIMIT', 'Consecutive losses limit reached - trading paused for risk management', 'RISK');
        logger.info({
          agentId,
          consecutiveLosses: dailyCounters.consecutiveLosses,
          reason: 'CONSECUTIVE_LOSSES_LIMIT'
        }, 'Execution blocked: consecutive losses limit reached');
        await firestoreAdapter.updateLastProcessedCandle(agentId, pairKey, candleTimestamp);
        return;
      }

      // Check daily profit target
      if (!isHTFAgent && dailyCounters.dailyPnL >= 2.0) {
        finalizeSkip('DAILY_PROFIT_TARGET', `Daily profit target reached: ${dailyCounters.dailyPnL.toFixed(2)}R`, 'RISK');
        logger.info({
          agentId,
          dailyPnL: dailyCounters.dailyPnL,
          reason: 'DAILY_PROFIT_TARGET'
        }, 'Execution blocked: daily profit target reached');
        await firestoreAdapter.updateLastProcessedCandle(agentId, pairKey, candleTimestamp);
        return;
      }

      // ===== COOLDOWN PRECISION =====
      // Check per-pair cooldown
      const pairCooldown = await firestoreAdapter.getPairCooldown(agentId, pairKey);
      if (!isHTFAgent && pairCooldown && new Date() < pairCooldown) {
        finalizeSkip('PAIR_COOLDOWN_ACTIVE', `Pair cooldown active until ${pairCooldown.toISOString()}`, 'RISK');
        logger.info({
          agentId,
          tradingPair,
          cooldownUntil: pairCooldown.toISOString(),
          reason: 'PAIR_COOLDOWN_ACTIVE'
        }, 'Execution blocked: pair cooldown active');
        await firestoreAdapter.updateLastProcessedCandle(agentId, pairKey, candleTimestamp);
        return;
      }

      // ===== MAX POSITION RACE PROTECTION =====
      // Check position limits with current counts
      const positionTrades = await firestoreAdapter.getAgentTrades(agentId, 50);
      const openTrades = (positionTrades || []).filter((t: any) => t?.status === 'OPEN');
      const pairOpenTrades = openTrades.filter((t: any) => normalizeSymbol(t?.tradingPair) === pairKey);
      const positionCounts = {
        pairPositions: pairOpenTrades.length,
        totalPositions: openTrades.length,
      };

      // Max 1 open trade per pair
      if (positionCounts.pairPositions >= 1) {
        finalizeSkip('PAIR_POSITION_LIMIT', `Pair position limit reached: ${positionCounts.pairPositions}/1`, 'RISK');
        logger.info({
          agentId,
          tradingPair,
          currentPositions: positionCounts.pairPositions,
          reason: 'PAIR_POSITION_LIMIT'
        }, 'Execution blocked: pair position limit reached');
        await firestoreAdapter.updateLastProcessedCandle(agentId, pairKey, candleTimestamp);
        return;
      }

      // Max 2 total open trades
      if (positionCounts.totalPositions >= 2) {
        finalizeSkip('TOTAL_POSITION_LIMIT', `Total position limit reached: ${positionCounts.totalPositions}/2`, 'RISK');
        logger.info({
          agentId,
          totalPositions: positionCounts.totalPositions,
          reason: 'TOTAL_POSITION_LIMIT'
        }, 'Execution blocked: total position limit reached');
        await firestoreAdapter.updateLastProcessedCandle(agentId, pairKey, candleTimestamp);
        return;
      }

      // Get COIN-M account balance
      const balance = await marketProvider.getAccountBalance();

      // Update diagnostics with balance info
      diagnostics.riskAnalysis = {
        accountBalance: balance.equity,
        riskPercent: isHTFAgent ? enforcedRiskPerTrade : agentConfig.riskPerTrade,
        positionSize: 0, // Will be calculated below
        maxPositionSize: 0, // Will be calculated below
        availableMargin: true
      };

      // Position sizing (validation-only)
      // For HTF agents, use enforced limits; for regular agents, use config
      const positionCalc = agent.calculatePositionSize(
        balance.equity,
        signal.entryPrice,
        signal.stopLoss,
        isHTFAgent ? enforcedLeverage : (agentConfig.leverage || 8),
      );

      if (!positionCalc.isSafe || !isFinite(positionCalc.positionSize) || positionCalc.positionSize <= 0) {
        finalizeSkip('POSITION_SIZING_REJECTED', `Position sizing rejected: ${positionCalc.reason || 'UNKNOWN'}`, 'RISK');
        await firestoreAdapter.updateLastProcessedCandle(agentId, pairKey, candleTimestamp);
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
        calculatedRR: signal.calculatedRR || 0,
        quantity: positionCalc.positionSize,
        leverage: isHTFAgent ? enforcedLeverage : (agentConfig.leverage || 8),
        riskPerTrade: isHTFAgent ? enforcedRiskPerTrade : agentConfig.riskPerTrade,
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
        await firestoreAdapter.setPairCooldown(agentId, pairKey, cooldownUntil);

        logger.info({
          agentId,
          tradeId: tradeRecord.id,
          signalId: tradeRecord.signalId,
          direction: tradeRecord.direction,
          entryPrice: tradeRecord.entryPrice,
          stopLoss: tradeRecord.stopLoss,
          takeProfit: tradeRecord.takeProfit,
          calculatedRR: tradeRecord.calculatedRR,
          quantity: tradeRecord.quantity,
          slTpPlacedOnExchange: true
        }, 'Trade executed successfully with SL/TP placed on exchange');
      } else {
        // CRITICAL: Exchange failure MUST count as an attempt to prevent retry loops
        tradeRecord.status = 'FAILED';
        tradeRecord.error = diagnostics?.execution?.error || 'ORDER_PLACEMENT_FAILED';
        tradeRecord.exchangeErrorReason = diagnostics?.execution?.exchangeErrorReason || diagnostics?.execution?.error || 'ORDER_PLACEMENT_FAILED';
        await firestoreAdapter.saveAgentTrade(tradeRecord);

        // CRITICAL: Apply cooldown even on exchange failure to prevent immediate retry
        // This prevents the same signal from being attempted every cycle
        const cooldownUntil = new Date(Date.now() + 30 * 60 * 1000);
        await firestoreAdapter.setPairCooldown(agentId, pairKey, cooldownUntil);

        // Update diagnostics decision to reflect exchange failure with cooldown
        diagnostics.decision = {
          action: 'EXCHANGE_FAILED_COOLDOWN',
          reason: `Exchange order failed: ${tradeRecord.error}. Cooldown applied until ${cooldownUntil.toISOString()}`,
          exchangeErrorReason: tradeRecord.exchangeErrorReason
        };

        logger.error({
          agentId,
          tradeId: tradeRecord.id,
          signalId: tradeRecord.signalId,
          cooldownUntil: cooldownUntil.toISOString(),
          error: tradeRecord.error,
          exchangeErrorReason: tradeRecord.exchangeErrorReason
        }, 'Order placement failed, trade marked as failed, cooldown applied to prevent retry loop');
      }

      // Update last processed candle
      await firestoreAdapter.updateLastProcessedCandle(agentId, pairKey, candleTimestamp);

      // CRITICAL: Add single diagnostic log line for HTF agents at end of successful execution
      if (isHTFAgent) {
        logger.info({
          agentId,
          tradingPair,
          orderSuccess,
          signalDirection: signal?.direction
        }, `[HTF_AGENT] cycle evaluated: exchangeUsable=${exchangeUsable}, scanExecuted=${marketScanExecuted}, signalGenerated=${signalGenerated}`);
      }

    } catch (error) {
      logger.error({
        agentId,
        tradingPair,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to execute agent with hardening');
    } finally {
      // CRITICAL FIX: ALWAYS persist diagnostics, even on early returns or exceptions
      // This guarantees ONE diagnostic entry per execution cycle
      try {
        // STRICT DIAGNOSTICS NORMALIZATION: Enforce invariants before persistence
        const normalizedDiagnostics = this.normalizeDiagnosticsForPersistence(diagnostics, agentId);
        
        await agent.storeDiagnostics(normalizedDiagnostics);
        
        logger.debug({ agentId, decision: normalizedDiagnostics.decision }, 'Agent diagnostics persisted with strict normalization');
      } catch (diagError) {
        logger.error({
          agentId,
          error: diagError instanceof Error ? diagError.message : 'Unknown error'
        }, 'CRITICAL: Failed to persist agent diagnostics');
      }
    }
  }

  /**
   * Place order on exchange with atomic SL/TP attachment
   */
  private async placeOrderFromTradeAtomic(trade: any, agentConfig: TradingAgentConfig, marketProvider: TradingAgentMarketProvider, diagnostics: any, agent: TradingAgent): Promise<boolean> {
    try {
      const uid = agentConfig.userId;
      const agentName = String(agentConfig.name || '');

      const side: 'BUY' | 'SELL' = trade.direction === 'LONG' ? 'BUY' : 'SELL';
      const normalizeSymbol = (value: string) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      const symbol = normalizeSymbol(trade.symbol || agentConfig.tradingPair);
      const quantity = Number(trade.quantity) || 0;

      if (!uid) {
        diagnostics.execution = { success: false, error: 'MISSING_USER_ID' };
        return false;
      }

      if (!symbol || !isFinite(quantity) || quantity <= 0) {
        diagnostics.execution = { success: false, error: 'INVALID_ORDER_PARAMS' };
        return false;
      }

      // CRITICAL: HTF Trend Filter Agent REAL ORDER PLACEMENT
      // For HTF auto-execution, this is ALWAYS a real order (testMode = false)
      // Manual test endpoints use executeManualTrade with testMode = true
      const isHTFAgent = (agentConfig as any).strategyType === 'HTF_TREND_FILTER' || 
                         (agentConfig.name && agentConfig.name.includes('HTF Trend Filter'));

      if (isHTFAgent) {
        logger.info({
          uid,
          agentId: agentConfig.id,
          symbol,
          side,
          quantity,
          stopLoss: trade.stopLoss,
          takeProfit: trade.takeProfit,
          testMode: false,
          realOrder: true
        }, '🚀 REAL_BITGET_ORDER_PLACED: HTF Trend Filter Agent placing REAL Bitget futures order');
      }

      // Place entry order (MARKET). SL/TP are placed immediately after entry on the exchange.
      const orderId = await marketProvider.placeOrder({
        symbol,
        side,
        type: 'MARKET',
        quantity,
        stopLoss: trade.stopLoss,
        takeProfit: trade.takeProfit,
      });

      diagnostics.execution = {
        success: true,
        orderId,
        entryPrice: Number(trade.entryPrice) || 0,
        stopLoss: Number(trade.stopLoss) || 0,
        takeProfit: Number(trade.takeProfit) || 0,
        calculatedRR: trade.calculatedRR || 0,
        slTpPlacedOnExchange: !!(trade.stopLoss || trade.takeProfit),
        testMode: false, // HTF auto-execution is ALWAYS real
        realOrderPlaced: true
      };

      // CRITICAL: Log successful REAL order placement for HTF agents
      if (isHTFAgent) {
        logger.info({
          uid,
          agentId: agentConfig.id,
          orderId,
          symbol,
          side,
          quantity,
          stopLoss: trade.stopLoss,
          takeProfit: trade.takeProfit,
          exchange: agentConfig.exchange,
          marketType: 'futures',
          testMode: false,
          realOrderConfirmed: true
        }, '✅ REAL_BITGET_ORDER_CONFIRMED: HTF Trend Filter Agent REAL order placed successfully on Bitget futures');
      }

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
          agentId: agentConfig.id,
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
        orderId,
        symbol,
        side,
        quantity,
      }, 'Trade entry order placed and persisted');

      return true;
    } catch (error) {
      // CRITICAL: Preserve RAW exchange error message for UI display
      // Priority: err.response.data.msg → err.response.data.message → err.message → stringified
      let exchangeErrorReason = 'Unknown error';
      if (error && typeof error === 'object') {
        const err = error as any;
        if (err.response?.data?.msg) {
          exchangeErrorReason = String(err.response.data.msg);
        } else if (err.response?.data?.message) {
          exchangeErrorReason = String(err.response.data.message);
        } else if (err.message) {
          exchangeErrorReason = String(err.message);
        } else {
          exchangeErrorReason = JSON.stringify(error);
        }
      }

      diagnostics.execution = {
        success: false,
        error: exchangeErrorReason,
        exchangeErrorReason, // Explicit field for UI
      };

      logger.error({
        agentId: agentConfig.id,
        tradeId: trade?.id,
        error: exchangeErrorReason,
        exchangeErrorReason,
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
        const stopLoss = Number(diagnostics?.signal?.stopLoss) || 0;
        const takeProfit = Number(diagnostics?.signal?.takeProfit) || 0;

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
              stopLoss,
              takeProfit,
              direction,
              calculatedRR: diagnostics?.signal?.rrRatio || 0,
              slTpPlacedOnExchange: true
            },
          });

          logger.info({
            agentId: `vwap_${userId}`,
            userId,
            direction,
            entryPrice,
            stopLoss,
            takeProfit,
            calculatedRR: diagnostics?.signal?.rrRatio || 0,
            quantity: qty
          }, 'VWAP trade executed with SL/TP placed on exchange');
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

  static async executeManualTrade(
    userId: string,
    context: {
      agentId: string;
      tradingPair: string;
      side: 'LONG' | 'SHORT';
      quantity: number;
      testMode: boolean;
      manualTrigger: boolean;
    }
  ): Promise<{
    success: boolean;
    message: string;
    orderId?: string;
    details?: any;
    error?: string;
    rawError?: string;
  }> {
    try {
      // HARD GUARD: Reject testMode completely - manual trades are REAL ONLY
      if (context.testMode === true) {
        logger.error({
          tag: '[MANUAL_TRADE_TEST_MODE_REJECTED]',
          userId,
          agentId: context.agentId,
          reason: 'Test mode is not supported for manual trades in production'
        }, 'Manual trade execution rejected - test mode not allowed');
        
        return {
          success: false,
          message: 'Test mode is not supported. Manual trades execute on real Bitget Futures only.',
          error: 'TEST_MODE_NOT_SUPPORTED'
        };
      }

      // DUPLICATE EXECUTION GUARD: Prevent multiple manual trades within 5-10 second window
      const executionKey = `${userId}#${context.agentId}`;
      const lastExecutionTime = AgentExecutionService.manualTradeExecutionGuard.get(executionKey);
      const now = Date.now();
      const COOLDOWN_MS = 8000; // 8 second cooldown window

      if (lastExecutionTime && (now - lastExecutionTime) < COOLDOWN_MS) {
        const remainingWait = Math.ceil((COOLDOWN_MS - (now - lastExecutionTime)) / 1000);
        logger.warn({
          tag: '[MANUAL_TRADE_DUPLICATE_PREVENTED]',
          userId,
          agentId: context.agentId,
          lastExecutionTime,
          remainingWaitSeconds: remainingWait
        }, `Manual trade blocked - please wait ${remainingWait}s before next trade`);
        
        return {
          success: false,
          message: `Too many manual trades. Please wait ${remainingWait} seconds before executing another trade.`,
          error: 'MANUAL_TRADE_COOLDOWN_ACTIVE'
        };
      }

      // Record this execution time
      AgentExecutionService.manualTradeExecutionGuard.set(executionKey, now);

      logger.warn({
        tag: '[REAL_MANUAL_TRADE_EXECUTION]',
        userId,
        agentId: context.agentId,
        tradingPair: context.tradingPair,
        side: context.side,
        quantity: context.quantity,
        executionMode: 'REAL_BITGET_FUTURES'
      }, 'Manual trade execution - REAL MODE (live Bitget Futures order)');

      // Get user's exchange configuration
      const exchangeConfig = await firestoreAdapter.getExchangeConfig(userId);
      if (!exchangeConfig || !exchangeConfig.exchange) {
        return {
          success: false,
          message: 'No exchange configured',
          error: 'EXCHANGE_NOT_CONFIGURED'
        };
      }

      // CHECK: If encryption secret has changed, reject manual trade and request reconnection
      if (exchangeConfig.encryptionInvalid === true) {
        logger.warn({ userId, agentId: context.agentId }, 'Manual trade rejected - exchange encryption invalid');
        return {
          success: false,
          message: 'Exchange keys are invalid due to encryption secret change. Please reconnect exchange.',
          error: 'EXCHANGE_CORRUPTED'
        };
      }

      const exchangeKey = exchangeConfig.exchange;

      try {
        // Decrypt exchange credentials
        let decryptedApiKey: string | null = null;
        let decryptedApiSecret: string | null = null;
        let decryptedPassphrase: string | null = null;

        try {
          decryptedApiKey = decrypt(exchangeConfig.apiKeyEncrypted, 'exchange');
          decryptedApiSecret = decrypt(exchangeConfig.secretKeyEncrypted || exchangeConfig.secretEncrypted, 'exchange');
          decryptedPassphrase = exchangeConfig.passphraseEncrypted ? 
            decrypt(exchangeConfig.passphraseEncrypted, 'exchange') : null;
        } catch (decryptError: any) {
          // Handle ENCRYPTION_SECRET_CHANGED error specifically
          if (decryptError.message?.includes('ENCRYPTION_SECRET_CHANGED')) {
            logger.warn({ userId, agentId: context.agentId, error: decryptError.message }, 'Exchange keys corrupted due to encryption secret change');
            
            // NOTE: Do NOT attempt to mark exchange as corrupted in Firestore
            // Exchange status is managed exclusively by /exchange/connect
            
            return {
              success: false,
              message: 'Exchange keys are invalid due to encryption secret change. Please reconnect exchange.',
              error: 'EXCHANGE_CORRUPTED'
            };
          }
          
          // Handle other decryption errors
          throw decryptError;
        }

        // EXECUTION GUARD: Assert keys are not null before proceeding
        if (!decryptedApiKey || decryptedApiKey.trim() === '') {
          throw new Error('EXCHANGE_KEYS_NOT_DECRYPTED: API key decryption failed or returned empty');
        }
        
        if (!decryptedApiSecret || decryptedApiSecret.trim() === '') {
          throw new Error('EXCHANGE_KEYS_NOT_DECRYPTED: Secret key decryption failed or returned empty');
        }

        // Create exchange connector
        const { ExchangeConnectorFactory } = await import('./exchangeConnector');
        // For manual trades: if testMode = false (real execution), force testnet = false
        // Otherwise default to sandbox/testnet for safety
        const exchangeCredentials = {
          apiKey: decryptedApiKey,
          secret: decryptedApiSecret,
          testnet: context.testMode ? (exchangeConfig.sandbox || true) : false
        };

        // Add passphrase for exchanges that require it
        if (exchangeKey === 'bitget' || exchangeKey === 'weex') {
          // EXECUTION GUARD: Assert passphrase is not null for required exchanges
          if (exchangeConfig.passphraseEncrypted && (!decryptedPassphrase || decryptedPassphrase.trim() === '')) {
            throw new Error('EXCHANGE_KEYS_NOT_DECRYPTED: Passphrase decryption failed or returned empty');
          }
          
          // For bitget/weex a real passphrase is required; do not default to 'test'
          if (!decryptedPassphrase || decryptedPassphrase.trim() === '') {
            throw new Error('Passphrase is required for ' + exchangeKey);
          }
          (exchangeCredentials as any).passphrase = decryptedPassphrase;
        }

        const connector = ExchangeConnectorFactory.create(exchangeKey, exchangeCredentials);

        // Test connection first
        const connectionTest = await connector.testConnection();
        if (!connectionTest.success) {
          return {
            success: false,
            message: 'Exchange connection failed',
            error: connectionTest.message,
            rawError: connectionTest.details?.toString()
          };
        }
        // Always execute REAL order (testMode is rejected above)
        // For actual trades, place the order on Bitget Futures
        if (connector.placeOrder) {
          // Log testMode value right before placing order
          logger.info({
            tag: '[MANUAL_TRADE_EXECUTION_MODE]',
            testMode: context.testMode,
            executionMode: context.testMode ? 'SIMULATION' : 'REAL_BITGET_FUTURES'
          }, 'Determining execution mode for manual trade');
          
          const orderParams = {
            symbol: context.tradingPair.replace('/', ''),
            side: context.side === 'LONG' ? 'BUY' as const : 'SELL' as const,
            type: 'MARKET' as const,
            quantity: context.quantity
          };

          const orderResult = await connector.placeOrder(orderParams);
          
          logger.warn({
            tag: '[REAL_MANUAL_TRADE_EXECUTION]',
            testMode: context.testMode,
            orderId: orderResult.orderId || orderResult.id,
            pair: context.tradingPair,
            side: context.side,
            quantity: context.quantity,
            exchange: exchangeKey
          }, 'REAL manual trade executed - order placed on Bitget Futures');
          
          return {
            success: true,
            message: `Manual trade executed successfully: ${context.side} ${context.quantity} ${context.tradingPair}`,
            orderId: orderResult.orderId || orderResult.id,
            details: {
              exchange: exchangeKey,
              pair: context.tradingPair,
              side: context.side,
              quantity: context.quantity,
              orderResult,
              timestamp: new Date().toISOString()
            }
          };
        } else {
          return {
            success: false,
            message: 'Exchange does not support order placement',
            error: 'ORDER_PLACEMENT_NOT_SUPPORTED'
          };
        }

      } catch (err: any) {
        logger.error({ err, userId, context }, 'Manual trade execution failed');
        
        // Map specific errors to exact error codes for UI
        let errorCode = err.message || 'Unknown execution error';
        
        if (err.message?.includes('ENCRYPTION_SECRET_CHANGED')) {
          errorCode = 'EXCHANGE_CORRUPTED';
        } else if (err.message?.includes('EXCHANGE_KEYS_NOT_DECRYPTED')) {
          errorCode = 'EXCHANGE_KEYS_NOT_DECRYPTED';
        } else if (err.message?.includes('PERMISSION_DENIED')) {
          errorCode = 'PERMISSION_DENIED';
        } else if (err.message?.includes('FUTURES_DISABLED')) {
          errorCode = 'FUTURES_DISABLED';
        } else if (err.message?.includes('SYMBOL_NOT_TRADABLE')) {
          errorCode = 'SYMBOL_NOT_TRADABLE';
        } else if (err.message?.includes('API key') || err.message?.includes('apiKey')) {
          errorCode = 'EXCHANGE_KEYS_NOT_DECRYPTED';
        } else if (err.message?.includes('Secret') || err.message?.includes('secret')) {
          errorCode = 'EXCHANGE_KEYS_NOT_DECRYPTED';
        }
        
        return {
          success: false,
          message: 'Trade execution failed',
          error: errorCode,
          rawError: err.toString()
        };
      }

    } catch (err: any) {
      logger.error({ err, userId, context }, 'Manual trade setup failed');
      
      // Map specific errors to exact error codes for UI
      let errorCode = err.message || 'Unknown setup error';
      
      if (err.message?.includes('EXCHANGE_KEYS_NOT_DECRYPTED')) {
        errorCode = 'EXCHANGE_KEYS_NOT_DECRYPTED';
      } else if (err.message?.includes('EXCHANGE_NOT_CONFIGURED')) {
        errorCode = 'EXCHANGE_NOT_CONFIGURED';
      }
      
      return {
        success: false,
        message: 'Trade setup failed',
        error: errorCode,
        rawError: err.toString()
      };
    }
  }
}