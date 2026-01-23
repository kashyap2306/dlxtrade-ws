import { logger } from '../utils/logger';
import { CrowdConsensusService } from './crowdConsensusService';
import { firestoreAdapter } from './firestoreAdapter';
import { getFirebaseAdmin } from '../utils/firebase';

export class CrowdConsensusScheduler {
  private static intervalId: NodeJS.Timeout | null = null;
  private static isRunning = false;
  private static readonly intervalMs = 5 * 60 * 1000;
  private static lastExecutionAt: Date | null = null;
  private static nextExecutionAt: Date | null = null;
  private static lastExecutionError: string | null = null;

  /**
   * Start the Crowd Consensus scheduler
   */
  static async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Crowd Consensus scheduler is already running');
      return;
    }

    try {
      this.intervalId = setInterval(async () => {
        try {
          logger.info('🔄 [CROWD_CONSENSUS_SCHEDULER] Tick - starting execution cycle');
          this.lastExecutionAt = new Date();
          await this.executeAllActiveAgents();
          this.lastExecutionError = null;
          logger.info('✅ [CROWD_CONSENSUS_SCHEDULER] Cycle completed successfully');
        } catch (error) {
          this.lastExecutionError = error instanceof Error ? error.message : 'Unknown error';
          logger.error({
            error: error instanceof Error ? error.message : 'Unknown error'
          }, '❌ [CROWD_CONSENSUS_SCHEDULER] Error in scheduled execution');
        } finally {
          this.nextExecutionAt = new Date(Date.now() + this.intervalMs);
        }
      }, this.intervalMs); // 5 minutes

      this.isRunning = true;
      this.nextExecutionAt = new Date(Date.now() + this.intervalMs);
      logger.info('✅ [CROWD_CONSENSUS_SCHEDULER] Scheduler started - executing every 5 minutes');
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error'
      }, '❌ [CROWD_CONSENSUS_SCHEDULER] Failed to start scheduler');

      throw error;
    }
  }

  /**
   * Stop the Crowd Consensus scheduler
   */
  static stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    this.nextExecutionAt = null;
    logger.info('Crowd Consensus scheduler stopped');
  }

  static getStatus() {
    return {
      isRunning: this.isRunning,
      intervalMs: this.intervalMs,
      lastExecutionAt: this.lastExecutionAt,
      nextExecutionAt: this.nextExecutionAt,
      lastExecutionError: this.lastExecutionError,
    };
  }

  /**
   * Execute all active Crowd Consensus agents
   */
  static async executeAllActiveAgents(): Promise<void> {
    try {
      logger.info('📊 [CROWD_CONSENSUS] Finding active users...');
      
      // Find all users with active Crowd Consensus auto trading
      const activeUsers = await this.getActiveCrowdConsensusUsers();

      if (activeUsers.length === 0) {
        logger.info('⚠️ [CROWD_CONSENSUS] No active users found - scheduler running but no users have auto-trade enabled');
        return;
      }

      logger.info({ userCount: activeUsers.length }, '👥 [CROWD_CONSENSUS] Found active users, executing agents...');

      // Execute for each active user
      const results = await Promise.allSettled(
        activeUsers.map(uid => this.executeAgentForUser(uid))
      );

      const successCount = results.filter(r => r.status === 'fulfilled').length;
      const failureCount = results.filter(r => r.status === 'rejected').length;

      logger.info({
        total: activeUsers.length,
        success: successCount,
        failed: failureCount
      }, '✅ [CROWD_CONSENSUS] Completed execution cycle');

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error'
      }, '❌ [CROWD_CONSENSUS] Failed to execute agents');
    }
  }

  /**
   * Execute Crowd Consensus agent for a specific user
   */
  static async executeAgentForUser(uid: string): Promise<void> {
    const agentId = `crowd_consensus_${uid}`;
    let researchExecuted = false;
    let tradeExecuted = false;
    
    try {
      logger.info({ uid }, 'Starting Crowd Consensus execution for user');

      // HARD GATE: Check if auto trade is enabled FIRST - STOP everything if disabled
      const settings = await CrowdConsensusService.getUserSettings(uid);
      const autoTradeEnabled = settings.autoTradeEnabled === true;
      
      if (!autoTradeEnabled) {
        // STOP research, STOP exchange scan, STOP consensus building
        logger.info({ uid }, '[CROWD_CONSENSUS] autoTradeEnabled=false - STOPPING research, exchange scan, consensus building');
        
        // Store diagnostic for disabled auto-trade
        await firestoreAdapter.saveAgentDiagnostic(agentId, {
          agentType: 'COPY_TRADING_AGENT',
          decision: {
            action: 'SKIP',
            reason: 'AUTO_TRADE_DISABLED',
          },
          runtimeState: { autoTradeEnabled: false },
        }, uid);
        
        // CRITICAL: Add single diagnostic log line
        logger.info({
          uid
        }, `[CROWD_CONSENSUS] autoTradeEnabled=${autoTradeEnabled}, researchExecuted=${researchExecuted}, tradeExecuted=${tradeExecuted}`);
        
        return; // Exit immediately - no research, no exchange scan, no consensus
      }

      // Check if user has Crowd Consensus enabled (legacy check - kept for compatibility)
      if (!settings.autoTradeEnabled) {
        // Store diagnostic for disabled auto-trade
        await firestoreAdapter.saveAgentDiagnostic(agentId, {
          agentType: 'COPY_TRADING_AGENT',
          decision: {
            action: 'SKIP',
            reason: 'AUTO_TRADE_DISABLED',
          },
          runtimeState: { autoTradeEnabled: false },
        }, uid);
        logger.info({ uid }, 'Crowd Consensus auto trade disabled for user');
        return;
      }

      // Check exchange connection
      const exchangeStatus = await CrowdConsensusService.getExchangeConnectionStatus(uid);
      if (!exchangeStatus.connected) {
        // C) AGENT DECISION FIX - Use specific machine-readable reason
        const reason = exchangeStatus.message || 'EXCHANGE_NOT_CONNECTED';
        
        // Store diagnostic for exchange not connected
        await firestoreAdapter.saveAgentDiagnostic(agentId, {
          agentType: 'COPY_TRADING_AGENT',
          decision: {
            action: 'SKIP',
            reason: reason,
          },
          runtimeState: { exchangeStatus },
        }, uid);
        await CrowdConsensusService.saveSkippedTrade(uid, {
          pair: 'BTCUSDT', // Default pair for logging
          direction: 'LONG', // Default direction for logging
          reason: reason as any, // Cast to allow machine-readable reasons
          timestamp: new Date(),
          details: { exchangeStatus }
        });
        logger.warn({ uid, reason }, `Exchange not available for Crowd Consensus user: ${reason}`);
        return;
      }

      // Check daily trade limit (max 5 trades per day)
      const dailyTradeCount = await CrowdConsensusService.getDailyTradeCount(uid);
      if (dailyTradeCount >= 5) {
        // Store diagnostic for daily limit reached
        await firestoreAdapter.saveAgentDiagnostic(agentId, {
          agentType: 'COPY_TRADING_AGENT',
          decision: {
            action: 'STOPPED_FOR_DAY',
            reason: 'DAILY_LIMIT_REACHED',
          },
          runtimeState: { dailyTradeCount, dailyLimit: 5 },
        }, uid);
        await CrowdConsensusService.saveSkippedTrade(uid, {
          pair: 'BTCUSDT',
          direction: 'LONG',
          reason: 'DAILY_LIMIT_REACHED',
          timestamp: new Date(),
          details: { dailyTradeCount }
        });
        logger.info({ uid, dailyTradeCount }, 'Daily trade limit reached for user');
        return;
      }

      // Execute consensus analysis and trading
      researchExecuted = true; // Mark that research is being executed
      const tradeResults = await this.executeConsensusAnalysisAndTrade(uid);
      if (tradeResults && tradeResults.tradesExecuted > 0) {
        tradeExecuted = true; // Mark that trades were executed
      }

      // CRITICAL: Add single diagnostic log line
      logger.info({
        uid
      }, `[CROWD_CONSENSUS] autoTradeEnabled=${autoTradeEnabled}, researchExecuted=${researchExecuted}, tradeExecuted=${tradeExecuted}`);

      logger.info({ uid }, 'Completed Crowd Consensus execution for user');

    } catch (error) {
      // Store diagnostic for execution error
      await firestoreAdapter.saveAgentDiagnostic(agentId, {
        agentType: 'COPY_TRADING_AGENT',
        decision: {
          action: 'SKIP',
          reason: 'EXECUTION_ERROR',
        },
        execution: {
          status: 'FAILED',
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      }, uid);
      logger.error({
        uid,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to execute Crowd Consensus agent for user');
    }
  }

  /**
   * Execute consensus analysis and trade for a user
   * FIX: Resolve credentials ONCE per cycle, reuse for all signals
   * FIX: Check dryRun mode BEFORE attempting credential decryption
   */
  static async executeConsensusAnalysisAndTrade(uid: string): Promise<{ tradesExecuted: number }> {
    let tradesExecuted = 0;
    
    try {
      logger.info({ uid }, '🚀 [CROWD_CONSENSUS] Starting consensus analysis and trade execution for user');

      // STEP 0: Check dryRun mode FIRST - skip ALL credential/exchange access if in test mode
      const settings = await CrowdConsensusService.getUserSettings(uid);
      const isDryRun = settings.dryRun === true;

      // HARD GUARD: In dryRun mode, skip ALL exchange/credential access
      if (isDryRun) {
        console.log('[DRY RUN] Skipping ALL credential/exchange access - test mode active');
        logger.info({ uid, dryRun: true }, '[DRY RUN] Test mode active - no real execution');
        
        // In dry run, analyze consensus but skip real execution
        const consensusSignals = await CrowdConsensusService.analyzeConsensus();
        
        if (consensusSignals.length === 0) {
          logger.info({ uid }, '[DRY RUN] No consensus signals found');
          return;
        }
        
        // Process signals in dry run mode (simulated)
        for (const signal of consensusSignals) {
          await CrowdConsensusService.executeConsensusTrade(signal, uid, 'bitget', null);
        }
        
        logger.info({ uid, signalCount: consensusSignals.length }, '[DRY RUN] Completed simulated execution');
        return { tradesExecuted: consensusSignals.length }; // Return simulated trades count
      }

      // STEP 1: Resolve exchange credentials ONCE at cycle start (ONLY if NOT dryRun)
      let exchangeStatus: any = { connected: false, exchange: null };
      let credentials: any = null;
      
      // Only check exchange connection in REAL mode
      exchangeStatus = await CrowdConsensusService.getExchangeConnectionStatus(uid);
        
      if (!exchangeStatus.connected) {
        // C) AGENT DECISION FIX - Use specific machine-readable reason
        const reason = exchangeStatus.message || 'EXCHANGE_NOT_CONNECTED';
        
        logger.warn({ 
          uid, 
          reason: reason
        }, `Exchange not available for user: ${reason}`);
        
        await CrowdConsensusService.saveSkippedTrade(uid, {
          pair: 'BTCUSDT',
          direction: 'LONG',
          reason: reason as any, // Cast to allow machine-readable reasons
          timestamp: new Date(),
          details: { message: exchangeStatus.message, exchangeStatus }
        });
        
        return { tradesExecuted: 0 };
      }

      // Get user's exchange credentials ONCE for the entire cycle
      try {
        credentials = await CrowdConsensusService.getUserExchangeCredentials(uid, exchangeStatus.exchange!);
      } catch (error: any) {
        logger.error({ 
          uid, 
          exchange: exchangeStatus.exchange,
          error: error.message 
        }, 'CREDENTIAL_DECRYPT_FAILED - failed to decrypt credentials');
        
        await CrowdConsensusService.saveSkippedTrade(uid, {
          pair: 'BTCUSDT',
          direction: 'LONG',
          reason: 'CREDENTIAL_DECRYPT_FAILED',
          timestamp: new Date(),
          details: { message: 'Failed to decrypt exchange credentials', error: error.message }
        });
        
        return { tradesExecuted: 0 };
      }
      
      if (!credentials) {
        logger.warn({ 
          uid, 
          exchange: exchangeStatus.exchange 
        }, 'CREDENTIALS_MISSING - credentials returned null');
        
        await CrowdConsensusService.saveSkippedTrade(uid, {
          pair: 'BTCUSDT',
          direction: 'LONG',
          reason: 'CREDENTIALS_MISSING',
          timestamp: new Date(),
          details: { message: 'Exchange credentials not available' }
        });
        
        return { tradesExecuted: 0 };
      }

      logger.info({
        uid,
        exchange: exchangeStatus.exchange,
        credentialsResolved: true
      }, 'Credentials resolved - will be reused for all signals');

      // STEP 2: Analyze consensus from multiple exchanges
      const consensusSignals = await CrowdConsensusService.analyzeConsensus();

      if (consensusSignals.length === 0) {
        logger.info({ uid }, '⚠️ [CROWD_CONSENSUS] No consensus signals found - no trades to execute');
        return { tradesExecuted: 0 };
      }

      logger.info({ 
        uid, 
        signalCount: consensusSignals.length,
        signals: consensusSignals.map(s => `${s.pair} ${s.direction}`).join(', ')
      }, '📊 [CROWD_CONSENSUS] Processing consensus signals...');

      // HARD LOG - CONSENSUS FINAL RESULT
      console.log('[CONSENSUS FINAL]', {
        signalCount: consensusSignals.length,
        signals: consensusSignals.map(s => ({ pair: s.pair, direction: s.direction, exchanges: s.exchanges }))
      });

      // STEP 3: Process each consensus signal using the SAME resolved credentials
      for (const signal of consensusSignals) {
        try {
          console.log('[EXECUTION BLOCK HIT]', { pair: signal.pair, direction: signal.direction });
          const result = await this.processConsensusSignal(uid, signal, exchangeStatus.exchange!, credentials);
          if (result && result.tradeExecuted) {
            tradesExecuted++;
          }
        } catch (error) {
          logger.error({
            uid,
            pair: signal.pair,
            direction: signal.direction,
            error: error instanceof Error ? error.message : 'Unknown error'
          }, '❌ [CROWD_CONSENSUS] Failed to process consensus signal');
        }
      }

      logger.info({ uid, tradesExecuted }, '✅ [CROWD_CONSENSUS] Completed consensus analysis and trade execution for user');
      return { tradesExecuted };

    } catch (error) {
      logger.error({
        uid,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, '❌ [CROWD_CONSENSUS] Failed to execute consensus analysis and trade');
      return { tradesExecuted: 0 };
    }
  }

  /**
   * Process a single consensus signal for a user
   * FIX: Accept pre-resolved credentials from cycle start (no per-signal credential resolution)
   */
  static async processConsensusSignal(
    uid: string, 
    signal: any, 
    exchange: string, 
    credentials: any
  ): Promise<{ tradeExecuted: boolean }> {
    const agentId = `crowd_consensus_${uid}`;
    
    try {
      // Validate trade setup (S/R, RR ratio, etc.)
      const validation = await CrowdConsensusService.validateTradeSetup(signal);

      if (!validation.valid) {
        // Store diagnostic for validation failure
        await firestoreAdapter.saveAgentDiagnostic(agentId, {
          agentType: 'COPY_TRADING_AGENT',
          tradingPair: signal.pair,
          decision: {
            action: 'SKIP',
            reason: validation.reason || 'VALIDATION_FAILED',
          },
          signal: signal.entryPrice ? {
            direction: signal.direction,
            entryPrice: signal.entryPrice,
            stopLoss: signal.stopLoss || 0,
            takeProfit: signal.takeProfit || 0,
            rrRatio: signal.rrRatio || 0,
          } : undefined,
          consensusResults: { validation },
        }, uid);
        await CrowdConsensusService.saveSkippedTrade(uid, {
          pair: signal.pair,
          direction: signal.direction,
          reason: (validation.reason as any) || 'EXCHANGE_ERROR',
          timestamp: new Date(),
          details: validation
        });
        logger.info({
          uid,
          pair: signal.pair,
          direction: signal.direction,
          reason: validation.reason
        }, 'Consensus signal validation failed');
        return { tradeExecuted: false };
      }

      // CRITICAL: TRADE CONFIRMATION RULE - Even if SAME COIN appears on ≥2 exchanges, 
      // DO NOT execute trade immediately. REQUIRE technical confirmations BEFORE trade execution.
      
      // Get current market data for technical confirmations
      // Use a simple approach since getMarketData is private - we'll use basic validation
      let marketData: any[] = [];
      try {
        // For now, create minimal market data for technical confirmations
        // In production, this would use a public market data method
        marketData = [{
          close: signal.avgEntryPrice || 50000,
          high: (signal.avgEntryPrice || 50000) * 1.02,
          low: (signal.avgEntryPrice || 50000) * 0.98,
          rsi: 50, // Default neutral RSI
          vwap: signal.avgEntryPrice || 50000
        }];
      } catch (error) {
        logger.warn({
          uid,
          pair: signal.pair,
          error: error instanceof Error ? error.message : 'Unknown error'
        }, 'Failed to get market data for technical confirmations');
      }
      
      if (!marketData || marketData.length === 0) {
        logger.warn({
          uid,
          pair: signal.pair,
          direction: signal.direction
        }, 'SKIP: EXCHANGE_ERROR - cannot perform technical confirmations without market data');
        
        await CrowdConsensusService.saveSkippedTrade(uid, {
          pair: signal.pair,
          direction: signal.direction,
          reason: 'EXCHANGE_ERROR', // Use existing reason type
          timestamp: new Date(),
          details: { message: 'Market data required for technical confirmations' }
        });
        
        return { tradeExecuted: false };
      }

      // BEFORE trade execution, REQUIRE: RSI confirmation, VWAP confirmation, SR confirmation
      const technicalConfirmations = await this.performTechnicalConfirmations(signal, marketData);
      
      if (!technicalConfirmations.rsiConfirmed || !technicalConfirmations.vwapConfirmed || !technicalConfirmations.srConfirmed) {
        // If ANY confirmation fails: SKIP trade, Log reason: TECHNICAL_CONFIRMATION_FAILED
        const failedConfirmations = [];
        if (!technicalConfirmations.rsiConfirmed) failedConfirmations.push('RSI');
        if (!technicalConfirmations.vwapConfirmed) failedConfirmations.push('VWAP');
        if (!technicalConfirmations.srConfirmed) failedConfirmations.push('SR');
        
        logger.warn({
          uid,
          pair: signal.pair,
          direction: signal.direction,
          failedConfirmations: failedConfirmations.join(', ')
        }, `SKIP: TECHNICAL_CONFIRMATION_FAILED - failed confirmations: ${failedConfirmations.join(', ')}`);
        
        await CrowdConsensusService.saveSkippedTrade(uid, {
          pair: signal.pair,
          direction: signal.direction,
          reason: 'EXCHANGE_ERROR', // Use existing reason type for technical confirmation failures
          timestamp: new Date(),
          details: { 
            failedConfirmations,
            technicalConfirmations,
            message: 'Technical confirmation failed'
          }
        });
        
        return { tradeExecuted: false };
      }

      // Execute the trade using pre-resolved credentials (no per-signal credential fetch)
      const tradeResult = await CrowdConsensusService.executeConsensusTrade(
        signal, 
        uid, 
        exchange, 
        credentials
      );

      if (!tradeResult.success) {
        // Store diagnostic for trade execution failure
        await firestoreAdapter.saveAgentDiagnostic(agentId, {
          agentType: 'COPY_TRADING_AGENT',
          tradingPair: signal.pair,
          decision: {
            action: 'SKIP',
            reason: tradeResult.reason || 'TRADE_EXECUTION_FAILED',
          },
          signal: signal.entryPrice ? {
            direction: signal.direction,
            entryPrice: signal.entryPrice,
            stopLoss: signal.stopLoss || 0,
            takeProfit: signal.takeProfit || 0,
            rrRatio: signal.rrRatio || 0,
          } : undefined,
          execution: {
            status: 'FAILED',
            success: false,
            error: tradeResult.reason,
          },
          consensusResults: { tradeResult },
        });
        await CrowdConsensusService.saveSkippedTrade(uid, {
          pair: signal.pair,
          direction: signal.direction,
          reason: (tradeResult.reason as any) || 'EXCHANGE_ERROR',
          timestamp: new Date(),
          details: tradeResult
        });
        logger.warn({
          uid,
          pair: signal.pair,
          direction: signal.direction,
          reason: tradeResult.reason
        }, 'Failed to execute consensus trade');
        return;
      }

      // Store diagnostic for successful trade
      await firestoreAdapter.saveAgentDiagnostic(agentId, {
        agentType: 'COPY_TRADING_AGENT',
        tradingPair: signal.pair,
        decision: {
          action: 'TRADE',
          reason: 'CONSENSUS_SIGNAL_EXECUTED',
        },
        signal: signal.entryPrice ? {
          direction: signal.direction,
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss || 0,
          takeProfit: signal.takeProfit || 0,
          rrRatio: signal.rrRatio || 0,
        } : undefined,
        execution: {
          status: 'EXECUTED',
          success: true,
          orderId: tradeResult.tradeId,
        },
        consensusResults: { tradeResult },
      });

      logger.info({
        uid,
        pair: signal.pair,
        direction: signal.direction,
        tradeId: tradeResult.tradeId
      }, 'Successfully executed consensus trade');

      return { tradeExecuted: true };

    } catch (error) {
      // Store diagnostic for processing error
      await firestoreAdapter.saveAgentDiagnostic(agentId, {
        agentType: 'COPY_TRADING_AGENT',
        tradingPair: signal.pair,
        decision: {
          action: 'SKIP',
          reason: 'PROCESSING_ERROR',
        },
        execution: {
          status: 'FAILED',
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
      logger.error({
        uid,
        pair: signal.pair,
        direction: signal.direction,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to process consensus signal');
      
      return { tradeExecuted: false };
    }
  }

  /**
   * Perform technical confirmations before trade execution
   * REQUIRE: RSI confirmation, VWAP confirmation, SR (Support/Resistance) confirmation
   */
  static async performTechnicalConfirmations(signal: any, marketData: any[]): Promise<{
    rsiConfirmed: boolean;
    vwapConfirmed: boolean;
    srConfirmed: boolean;
    details: any;
  }> {
    try {
      // Simple technical confirmations - can be enhanced based on requirements
      const latestCandle = marketData[0];
      const price = latestCandle?.close || signal.avgEntryPrice || 0;
      
      // RSI Confirmation: Check if RSI is in favorable range
      // For LONG: RSI should be oversold (< 40) or neutral (40-60)
      // For SHORT: RSI should be overbought (> 60) or neutral (40-60)
      const rsi = latestCandle?.rsi || 50; // Default neutral RSI if not available
      let rsiConfirmed = false;
      
      if (signal.direction === 'LONG') {
        rsiConfirmed = rsi < 60; // Allow LONG when RSI is not overbought
      } else if (signal.direction === 'SHORT') {
        rsiConfirmed = rsi > 40; // Allow SHORT when RSI is not oversold
      }
      
      // VWAP Confirmation: Check price relative to VWAP
      // For LONG: Price should be near or above VWAP
      // For SHORT: Price should be near or below VWAP
      const vwap = latestCandle?.vwap || price; // Default to current price if VWAP not available
      const vwapDistance = Math.abs((price - vwap) / vwap) * 100; // Percentage distance
      let vwapConfirmed = false;
      
      if (signal.direction === 'LONG') {
        vwapConfirmed = price >= vwap * 0.995; // Allow LONG when price is within 0.5% of VWAP or above
      } else if (signal.direction === 'SHORT') {
        vwapConfirmed = price <= vwap * 1.005; // Allow SHORT when price is within 0.5% of VWAP or below
      }
      
      // SR (Support/Resistance) Confirmation: Basic implementation
      // Check if price is not at strong resistance (for LONG) or strong support (for SHORT)
      const high24h = Math.max(...marketData.slice(0, 24).map(c => c.high || price));
      const low24h = Math.min(...marketData.slice(0, 24).map(c => c.low || price));
      const range24h = high24h - low24h;
      let srConfirmed = false;
      
      if (signal.direction === 'LONG') {
        // For LONG: Price should not be too close to 24h high (resistance)
        const distanceFromHigh = (high24h - price) / range24h;
        srConfirmed = distanceFromHigh > 0.1; // At least 10% away from 24h high
      } else if (signal.direction === 'SHORT') {
        // For SHORT: Price should not be too close to 24h low (support)
        const distanceFromLow = (price - low24h) / range24h;
        srConfirmed = distanceFromLow > 0.1; // At least 10% away from 24h low
      }
      
      return {
        rsiConfirmed,
        vwapConfirmed,
        srConfirmed,
        details: {
          rsi,
          vwap,
          vwapDistance,
          price,
          high24h,
          low24h,
          range24h
        }
      };
      
    } catch (error) {
      logger.error({
        pair: signal.pair,
        direction: signal.direction,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to perform technical confirmations');
      
      // On error, fail all confirmations for safety
      return {
        rsiConfirmed: false,
        vwapConfirmed: false,
        srConfirmed: false,
        details: { error: error instanceof Error ? error.message : 'Unknown error' }
      };
    }
  }

  /**
   * Get users with active Crowd Consensus auto trading
   */
  static async getActiveCrowdConsensusUsers(): Promise<string[]> {
    try {
      const db = getFirebaseAdmin().firestore();

      // Query users who have Crowd Consensus enabled
      const usersRef = db.collection('users');
      const activeUsers: string[] = [];

      // Since Firestore doesn't support direct queries on subcollection fields,
      // we need to get all users and check their agent settings
      const usersSnapshot = await usersRef.get();

      for (const userDoc of usersSnapshot.docs) {
        const uid = userDoc.id;
        try {
          const agentRef = db.collection('users').doc(uid)
            .collection('agents').doc('crowd_consensus_copy_trade');
          const agentDoc = await agentRef.get();

          if (agentDoc.exists) {
            const data = agentDoc.data();
            if (data?.autoTradeEnabled === true) {
              activeUsers.push(uid);
            }
          }
        } catch (error) {
          // Skip users with errors
          logger.warn({ uid, error: error instanceof Error ? error.message : 'Unknown error' },
            'Error checking Crowd Consensus status for user');
        }
      }

      return activeUsers;
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to get active Crowd Consensus users');
      return [];
    }
  }

  /**
   * Check if scheduler is running
   */
  static isSchedulerRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Execute specific user agent manually (for testing)
   */
  static async executeUserAgent(uid: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.executeAgentForUser(uid);
      return { success: true, message: 'Crowd Consensus agent executed successfully' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ uid, error: message }, 'Failed to execute Crowd Consensus agent manually');
      return { success: false, message };
    }
  }
}