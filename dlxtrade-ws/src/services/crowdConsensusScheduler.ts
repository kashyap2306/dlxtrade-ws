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
    
    try {
      logger.info({ uid }, 'Starting Crowd Consensus execution for user');

      // Check if user has Crowd Consensus enabled
      const settings = await CrowdConsensusService.getUserSettings(uid);
      if (!settings.autoTradeEnabled) {
        // Store diagnostic for disabled auto-trade
        await firestoreAdapter.saveAgentDiagnostic(agentId, {
          agentType: 'COPY_TRADING_AGENT',
          decision: {
            action: 'SKIP',
            reason: 'AUTO_TRADE_DISABLED',
          },
          runtimeState: { autoTradeEnabled: false },
        });
        logger.info({ uid }, 'Crowd Consensus auto trade disabled for user');
        return;
      }

      // Check exchange connection
      const exchangeStatus = await CrowdConsensusService.getExchangeConnectionStatus(uid);
      if (!exchangeStatus.connected) {
        // Store diagnostic for exchange not connected
        await firestoreAdapter.saveAgentDiagnostic(agentId, {
          agentType: 'COPY_TRADING_AGENT',
          decision: {
            action: 'SKIP',
            reason: 'EXCHANGE_NOT_CONNECTED',
          },
          runtimeState: { exchangeStatus },
        });
        await CrowdConsensusService.saveSkippedTrade(uid, {
          pair: 'BTCUSDT', // Default pair for logging
          direction: 'LONG', // Default direction for logging
          reason: 'EXCHANGE_ERROR',
          timestamp: new Date(),
          details: { exchangeStatus }
        });
        logger.warn({ uid }, 'Exchange not connected for Crowd Consensus user');
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
        });
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
      await this.executeConsensusAnalysisAndTrade(uid);

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
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
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
  static async executeConsensusAnalysisAndTrade(uid: string): Promise<void> {
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
        return; // Exit early - no real exchange access
      }

      // STEP 1: Resolve exchange credentials ONCE at cycle start (ONLY if NOT dryRun)
      let exchangeStatus: any = { connected: false, exchange: null };
      let credentials: any = null;
      
      // Only check exchange connection in REAL mode
      exchangeStatus = await CrowdConsensusService.getExchangeConnectionStatus(uid);
        
      if (!exchangeStatus.connected) {
        logger.warn({ 
          uid, 
          message: exchangeStatus.message 
        }, 'EXCHANGE_NOT_CONNECTED - user has no exchange configured');
        
        await CrowdConsensusService.saveSkippedTrade(uid, {
          pair: 'BTCUSDT',
          direction: 'LONG',
          reason: 'EXCHANGE_ERROR',
          timestamp: new Date(),
          details: { message: 'Exchange not connected', exchangeStatus }
        });
        
        return;
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
          reason: 'EXCHANGE_ERROR',
          timestamp: new Date(),
          details: { message: 'Exchange not connected', error: error.message }
        });
        
        return;
      }
      
      if (!credentials) {
        logger.warn({ 
          uid, 
          exchange: exchangeStatus.exchange 
        }, 'CREDENTIALS_MISSING - credentials returned null');
        
        await CrowdConsensusService.saveSkippedTrade(uid, {
          pair: 'BTCUSDT',
          direction: 'LONG',
          reason: 'EXCHANGE_ERROR',
          timestamp: new Date(),
          details: { message: 'Exchange not connected' }
        });
        
        return;
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
        return;
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
          await this.processConsensusSignal(uid, signal, exchangeStatus.exchange!, credentials);
        } catch (error) {
          logger.error({
            uid,
            pair: signal.pair,
            direction: signal.direction,
            error: error instanceof Error ? error.message : 'Unknown error'
          }, '❌ [CROWD_CONSENSUS] Failed to process consensus signal');
        }
      }

      logger.info({ uid }, '✅ [CROWD_CONSENSUS] Completed consensus analysis and trade execution for user');

    } catch (error) {
      logger.error({
        uid,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, '❌ [CROWD_CONSENSUS] Failed to execute consensus analysis and trade');
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
  ): Promise<void> {
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
        });
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
        return;
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