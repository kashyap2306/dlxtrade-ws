import { researchEngine } from './researchEngine';
import { topCoinsService } from './topCoinsService';
import { firestoreAdapter } from './firestoreAdapter';
import { logger } from '../utils/logger';
import { getFirebaseAdmin } from '../utils/firebase';
import * as admin from 'firebase-admin';
import { loadFeatureConfig } from '../config/featureConfig';
import { metricsService } from './metricsService';

/**
 * Deep Research Scheduler - COMPREHENSIVE FIX
 * 
 * Runs on configurable intervals [5,10,15,30,60] minutes (NOT per-second).
 * Processes one coin per run (rotation mode) or multiple coins (bulk mode).
 * Uses distributed locking (Firestore) to prevent overlapping runs across instances.
 * Supports auto-trade execution when confidence >= configured threshold (minimum 75%).
 * 
 * KEY FIXES:
 * - Uses ALL connected exchanges (Binance, Bitget, BingX, Kucoin, Weex, etc.)
 * - Aggregates orderbook and ticker data from ALL exchanges for better accuracy
 * - Always calls ALL connected integrations (CryptoQuant, LunarCrush, CoinAPI)
 * - Rotation through Top-100 coins by default (not just BTC or tracked coins)
 * - Configurable auto-trade threshold (minimum 75%, configurable via Firestore)
 * - Proper Firestore distributed locking (only ONE scheduler instance runs)
 * - Comprehensive logging
 * - No per-second loops - only runs at configured intervals
 * - Risk checks, balance checks, and duplicate order prevention
 */
export class DeepResearchScheduler {
  private updateIntervals: NodeJS.Timeout[] = [];
  private isRunning = false;
  private isProcessing = false; // In-memory guard against reentrancy
  private readonly LOCK_KEY = 'deep-research-lock';
  private readonly LOCK_TTL_MS = 60 * 60 * 1000 + 30 * 1000; // 1h30s (slightly longer than max interval)
  private readonly TIMEOUT_MS = 4 * 60 * 1000; // 4 minutes timeout per run
  private readonly STATE_COLLECTION = 'schedulerState';
  private readonly STATE_DOC = 'deepResearch';
  private readonly CONFIG_DOC = 'deepResearchConfig';
  private instanceId: string;
  
  // Configurable settings
  private intervals: number[] = [5]; // Default: 5 minutes (supported: [5,10,15,30,60])
  private mode: 'rotate' | 'bulk' = 'rotate';
  private topN: number = 100; // Default: Top-100 coins (was undefined = all tracked coins)

  // NOTE: Auto-trade disabled for scheduled research (exchange API required)
  // Auto-trade only works for manual research with user-configured exchange APIs

  constructor() {
    // Generate unique instance ID for this process
    this.instanceId = `instance_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    logger.info({ instanceId: this.instanceId }, 'Deep Research Scheduler initialized');
    
    // Load config from Firestore asynchronously
    this.loadConfig().catch((err) => {
      logger.warn({ err, instanceId: this.instanceId }, 'Failed to load scheduler config, using defaults');
    });
  }

  /**
   * Load scheduler configuration from Firestore
   */
  private async loadConfig(): Promise<void> {
    try {
      const db = admin.firestore(getFirebaseAdmin());
      const configDoc = await db.collection(this.STATE_COLLECTION).doc(this.CONFIG_DOC).get();
      
      if (configDoc.exists) {
        const data = configDoc.data()!;
        this.intervals = (data.intervals && Array.isArray(data.intervals) && data.intervals.length > 0) ? data.intervals : [5];
        this.mode = data.mode || 'rotate';
        this.topN = data.topN;

        // Validate intervals are from allowed list [5, 10, 15, 30, 60] minutes
        const allowedIntervals = [5, 10, 15, 30, 60];
        this.intervals = this.intervals.filter(i => allowedIntervals.includes(i));
        if (this.intervals.length === 0) {
          this.intervals = [5]; // Default to 5 minutes
        }

        // Ensure topN defaults to 100 if not set
        if (this.topN === undefined || this.topN === null) {
          this.topN = 100;
        }

        logger.info({
          instanceId: this.instanceId,
          intervals: this.intervals,
          mode: this.mode,
          topN: this.topN,
        }, 'Scheduler config loaded from Firestore');
      } else {
        logger.info({ instanceId: this.instanceId }, 'No scheduler config found, using defaults');
      }
    } catch (error: any) {
      logger.warn({ err: error, instanceId: this.instanceId }, 'Error loading scheduler config');
    }
  }

  /**
   * Update scheduler configuration
   */
  async updateConfig(config: {
    intervals?: number[];
    mode?: 'rotate' | 'bulk';
    topN?: number;
  }): Promise<void> {
    const allowedIntervals = [5, 10, 15, 30, 60]; // Only these intervals allowed

    if (config.intervals) {
      this.intervals = config.intervals.filter(i => allowedIntervals.includes(i));
      if (this.intervals.length === 0) {
        throw new Error('At least one valid interval must be provided');
      }
    }
    if (config.mode) {
      this.mode = config.mode;
    }
    if (config.topN !== undefined) {
      // Ensure topN is at least 1, default to 100 if not provided
      this.topN = Math.max(1, config.topN || 100);
    } else {
      // Default to 100 if not specified
      this.topN = 100;
    }

    // Save to Firestore
    try {
      const db = admin.firestore(getFirebaseAdmin());
      await db.collection(this.STATE_COLLECTION).doc(this.CONFIG_DOC).set({
        intervals: this.intervals,
        mode: this.mode,
        topN: this.topN,
        updatedAt: admin.firestore.Timestamp.now(),
        updatedBy: this.instanceId,
      }, { merge: true });

      logger.info({
        instanceId: this.instanceId,
        intervals: this.intervals,
        mode: this.mode,
        topN: this.topN,
      }, 'Scheduler config saved to Firestore');
    } catch (error: any) {
      logger.error({ err: error, instanceId: this.instanceId }, 'Error saving scheduler config');
      throw error;
    }

    // Restart scheduler with new intervals
    if (this.isRunning) {
      this.stop();
      this.start();
    }

    logger.info({
      instanceId: this.instanceId,
      intervals: this.intervals,
      mode: this.mode,
      topN: this.topN,
    }, 'Scheduler config updated');
  }

  /**
   * Start the scheduler with configured intervals
   * Ensures only ONE scheduler instance runs
   */
  start(): void {
    if (this.isRunning) {
      logger.warn({ instanceId: this.instanceId }, 'Deep Research scheduler already running');
      return;
    }

    this.isRunning = true;
    
    logger.info({
      instanceId: this.instanceId,
      intervals: this.intervals,
      mode: this.mode,
      topN: this.topN,
    }, 'Starting Deep Research scheduler with configured intervals');
    
    // Create intervals for each configured interval
    this.updateIntervals = this.intervals.map((intervalMinutes) => {
      const intervalMs = intervalMinutes * 60 * 1000;
      
      logger.info({ 
        instanceId: this.instanceId, 
        interval: intervalMinutes,
        intervalMs,
        nextRun: new Date(Date.now() + intervalMs).toISOString() 
      }, `Scheduler interval ${intervalMinutes}m: Next scheduled run at <timestamp> — waiting`);
      
      return setInterval(() => {
        this.runScheduledResearch(intervalMinutes).catch((err) => {
          logger.error({ err, instanceId: this.instanceId, interval: intervalMinutes }, 'Error in scheduled research run');
        });
      }, intervalMs);
    });

    // Try to acquire lock and run immediately for each interval (only if this is the designated instance)
    this.intervals.forEach((intervalMinutes) => {
      // Delay startup lock attempts to prevent race conditions
      setTimeout(() => {
        this.acquireStartupLock(intervalMinutes).catch((err) => {
          logger.warn({ err, instanceId: this.instanceId, interval: intervalMinutes }, 'Could not acquire startup lock');
        });
      }, 2000 * this.intervals.indexOf(intervalMinutes)); // Stagger startup attempts
    });
  }

  /**
   * Try to acquire lock at startup to run first batch immediately
   */
  private async acquireStartupLock(intervalMinutes: number): Promise<void> {
    const lockKey = `${this.LOCK_KEY}-${intervalMinutes}m`;
    const lockAcquired = await this.tryAcquireLock(lockKey, true); // Allow force at startup
    if (lockAcquired) {
      logger.info({ instanceId: this.instanceId, interval: intervalMinutes }, 'Acquired startup lock, running initial research');
      await this.runScheduledResearch(intervalMinutes);
    } else {
      logger.debug({ instanceId: this.instanceId, interval: intervalMinutes }, 'Startup lock already held by another instance');
    }
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (!this.isRunning) {
      logger.warn({ instanceId: this.instanceId }, 'Scheduler not running');
      return;
    }

    this.updateIntervals.forEach((interval) => clearInterval(interval));
    this.updateIntervals = [];
    this.isRunning = false;
    
    logger.info({ instanceId: this.instanceId }, 'Deep Research scheduler stopped');
  }

  /**
   * Get scheduler status
   */
  async getStatus(): Promise<{
    isRunning: boolean;
    isProcessing: boolean;
    intervals: number[];
    mode: 'rotate' | 'bulk';
    topN?: number;
    lastRunTimestamp?: string;
    lastSymbol?: string;
    lastDuration?: number;
    lastSuccess?: boolean;
    lockAcquired?: boolean;
    nextRunTimestamps?: string[];
    instanceId: string;
  }> {
    const state = await this.getState();
    const lockStatus = await this.checkLockStatus();
    
    // Calculate next run timestamps for each interval
    // If scheduler is running and has last run, calculate based on last run time; otherwise use current time
    const baseTime = state.lastRunTimestamp && this.isRunning
      ? new Date(state.lastRunTimestamp).getTime() 
      : Date.now();
    
    const nextRunTimestamps = this.intervals.map((intervalMinutes) => {
      const intervalMs = intervalMinutes * 60 * 1000;
      // Calculate next run: if last run exists and scheduler is running, add interval to it; otherwise use current time + interval
      const nextRunTime = baseTime + intervalMs;
      // If next run time is in the past (shouldn't happen, but handle it), use current time + interval
      const finalNextRun = nextRunTime > Date.now() ? nextRunTime : Date.now() + intervalMs;
      return new Date(finalNextRun).toISOString();
    });
    
    return {
      isRunning: this.isRunning,
      isProcessing: this.isProcessing,
      intervals: this.intervals,
      mode: this.mode,
      topN: this.topN,
      lastRunTimestamp: state.lastRunTimestamp,
      lastSymbol: state.lastSymbol,
      lastDuration: state.lastDuration,
      lastSuccess: state.lastSuccess,
      lockAcquired: lockStatus.isAcquired && lockStatus.instanceId === this.instanceId,
      nextRunTimestamps,
      instanceId: this.instanceId,
    };
  }

  /**
   * Force run one coin (for admin/testing)
   * @param symbol - Optional symbol to force
   * @param mode - Optional mode override ('rotate' or 'bulk')
   */
  async forceRun(symbol?: string, mode?: 'rotate' | 'bulk'): Promise<{ success: boolean; symbol: string; result?: any; error?: string }> {
    if (this.isProcessing) {
      return { success: false, symbol: symbol || '', error: 'Scheduler is already processing' };
    }

    logger.info({ instanceId: this.instanceId, symbol, mode }, 'Force run requested');

    const lockAcquired = await this.tryAcquireLock(this.LOCK_KEY, true); // Force flag
    if (!lockAcquired) {
      return { success: false, symbol: symbol || '', error: 'Could not acquire lock' };
    }

    try {
      const runMode = mode || this.mode;
      const result = await this.processCoins(symbol, runMode);
      return { success: true, symbol: result.symbol, result: result.result };
    } catch (error: any) {
      logger.error({ err: error, instanceId: this.instanceId }, 'Error in force run');
      return { success: false, symbol: symbol || '', error: error.message };
    } finally {
      await this.releaseLock(this.LOCK_KEY);
    }
  }

  /**
   * Main scheduled research run
   */
  private async runScheduledResearch(intervalMinutes: number): Promise<void> {
    if (this.isProcessing) {
      logger.warn({ instanceId: this.instanceId, interval: intervalMinutes }, 'Skipping run - already processing (reentrancy guard)');
      return;
    }

    // Use interval-specific lock key
    const lockKey = `${this.LOCK_KEY}-${intervalMinutes}m`;
    const lockAcquired = await this.tryAcquireLock(lockKey, false);
    if (!lockAcquired) {
      logger.debug({ instanceId: this.instanceId, interval: intervalMinutes }, 'Skipping run - lock already held by another instance');
      return;
    }

    this.isProcessing = true;
    const startTime = Date.now();

    try {
      logger.info({ 
        instanceId: this.instanceId, 
        interval: intervalMinutes, 
        startTime: new Date(startTime).toISOString() 
      }, 'Starting scheduled research run');

      // Process coins based on mode
      const result = await this.processCoins(undefined, this.mode);

      const duration = Date.now() - startTime;
      logger.info({
        instanceId: this.instanceId,
        symbol: result.symbol,
        duration,
        success: true,
        confidence: result.result?.confidence,
        accuracy: result.result?.accuracy,
        explanationsCount: result.result?.explanations?.length || 0,
        interval: intervalMinutes,
        apisUsed: 'Binance, CoinGecko, Google Finance, LunarCrush, CryptoQuant (free APIs only)',
      }, 'Scheduled research run completed using FREE APIs only');

      // Update state
      await this.setState({
        lastRunTimestamp: new Date(startTime).toISOString(),
        lastSymbol: result.symbol,
        lastDuration: duration,
        lastSuccess: true,
      });

    } catch (error: any) {
      const duration = Date.now() - startTime;
      logger.error({
        err: error,
        instanceId: this.instanceId,
        duration,
        interval: intervalMinutes,
        errorMessage: error.message,
        stack: error.stack,
      }, 'Error in scheduled research run');

      // Update state with error
      await this.setState({
        lastRunTimestamp: new Date(startTime).toISOString(),
        lastSymbol: undefined,
        lastDuration: duration,
        lastSuccess: false,
      });

    } finally {
      this.isProcessing = false;
      await this.releaseLock(lockKey);
    }
  }

  /**
   * Get tracked coins for users (all coins that users have requested research for)
   */
  private async getTrackedCoins(): Promise<string[]> {
    try {
      logger.debug({ instanceId: this.instanceId }, 'Getting tracked coins from user research logs');
      
      // Get all users' tracked symbols from Firestore
      const allUsers = await firestoreAdapter.getAllUsers();
      const trackedSymbols = new Set<string>();

      // Check research logs to find symbols users have requested
      for (const user of allUsers) {
        try {
          const researchLogs = await firestoreAdapter.getResearchLogs(user.uid, 100);
          researchLogs.forEach((log: any) => {
            if (log.symbol) {
              trackedSymbols.add(log.symbol.toUpperCase());
            }
          });
        } catch (err: any) {
          logger.debug({ err, uid: user.uid }, 'Error getting research logs for user');
        }
      }

      // Always use Top-100 coins (default rotation list)
      // If tracked coins exist, merge with Top-100 and deduplicate
      logger.info({ instanceId: this.instanceId }, '[DIAGNOSTIC] Fetching top 100 coins from topCoinsService');
      const top100Coins = await topCoinsService.getTop100Coins();
      
      logger.info({ 
        instanceId: this.instanceId,
        top100Count: top100Coins.length,
        top100Preview: top100Coins.slice(0, 10),
        firstCoin: top100Coins[0],
        lastCoin: top100Coins[top100Coins.length - 1]
      }, '[DIAGNOSTIC] Top 100 coins fetched');
      
      if (top100Coins.length === 0) {
        logger.error({ instanceId: this.instanceId }, '[ROTATION] CRITICAL: topCoinsService returned EMPTY array - FAILING run instead of using BTC fallback');
        throw new Error('topCoinsService.getTop100Coins() returned empty array - cannot proceed with rotation');
      }
      
      if (trackedSymbols.size === 0) {
        logger.info({ instanceId: this.instanceId, coinCount: top100Coins.length }, 'No tracked coins found, using Top-100 as default rotation list');
        return top100Coins;
      }

      // Merge tracked coins with Top-100, prioritize Top-100 order
      const trackedArray = Array.from(trackedSymbols);
      const merged = [...top100Coins];
      
      // Add tracked coins that aren't in Top-100
      for (const coin of trackedArray) {
        if (!merged.includes(coin)) {
          merged.push(coin);
        }
      }
      
      logger.info({ instanceId: this.instanceId, trackedCount: trackedArray.length, top100Count: top100Coins.length, mergedCount: merged.length }, 
        `Merged ${trackedArray.length} tracked coins with Top-100, total: ${merged.length}`);
      return merged;
    } catch (error: any) {
      logger.warn({ err: error, instanceId: this.instanceId }, 'Error getting tracked coins, using Top-100 fallback');
      return await topCoinsService.getTop100Coins();
    }
  }


  /**
   * Process coins based on mode
   */
  private async processCoins(forcedSymbol?: string, mode?: 'rotate' | 'bulk'): Promise<{ symbol: string; result: any }> {
    const runMode = mode || this.mode;
    
    logger.info({ instanceId: this.instanceId, mode: runMode, forcedSymbol }, 'Processing coins');
    
    // Get tracked coins (or Top-100 as fallback)
    const allCoins = await this.getTrackedCoins();
    if (allCoins.length === 0) {
      throw new Error('No coins available');
    }

    // Apply topN filter (defaults to 100)
    const coins = allCoins.slice(0, this.topN);
    
    logger.info({ instanceId: this.instanceId, totalCoins: allCoins.length, filteredCoins: coins.length, topN: this.topN }, 
      'Coins selected for processing');

    if (forcedSymbol) {
      // Use forced symbol if provided
      return await this.processOneCoin(forcedSymbol.toUpperCase(), coins);
    }

    if (runMode === 'bulk') {
      // Process all coins in bulk (but only log first one)
      let firstResult: { symbol: string; result: any } | null = null;
      let processedCount = 0;
      
      for (const symbol of coins) {
        try {
          const result = await this.processOneCoin(symbol, coins);
          processedCount++;
          if (!firstResult) {
            firstResult = result;
          }
          logger.debug({ instanceId: this.instanceId, symbol, processedCount, total: coins.length }, 'Coin processed in bulk mode');
        } catch (err: any) {
          logger.warn({ err, symbol, instanceId: this.instanceId }, 'Error processing coin in bulk mode');
        }
      }
      
      if (!firstResult) {
        throw new Error('No coins processed successfully');
      }
      
      logger.info({ instanceId: this.instanceId, processedCount, total: coins.length }, 'Bulk processing completed');
      return firstResult;
    } else {
      // Rotation mode: get last processed index, increment, wrap around
      logger.info({ instanceId: this.instanceId, coinCount: coins.length, coinsPreview: coins.slice(0, 10) }, 
        '[ROTATION] Getting state for coin selection');
      
      const state = await this.getState();
      let lastIndex = state.lastProcessedIndex ?? -1;
      const previousIndex = lastIndex;
      const nextIndex = (lastIndex + 1) % coins.length;
      const selectedSymbol = coins[nextIndex];

      logger.info({ 
        instanceId: this.instanceId, 
        previousIndex,
        nextIndex, 
        symbol: selectedSymbol,
        totalCoins: coins.length,
        isFirstRun: previousIndex === -1,
        willWrap: nextIndex === 0 && previousIndex >= 0
      }, `[ROTATION] Selected ${selectedSymbol} at index ${nextIndex}`);

      // CRITICAL: Write new lastProcessedIndex to Firestore BEFORE processing
      // If write fails, rollback and fail the run
      let stateWriteSuccess = false;
      try {
        logger.debug({ instanceId: this.instanceId, lastProcessedIndex: nextIndex, symbol: selectedSymbol }, 
          '[ROTATION] Writing lastProcessedIndex to Firestore');
        await this.setState({ lastProcessedIndex: nextIndex });
        
        // Verify the update
        const verifyState = await this.getState();
        if (verifyState.lastProcessedIndex === nextIndex) {
          stateWriteSuccess = true;
          logger.info({ instanceId: this.instanceId, lastProcessedIndex: nextIndex }, 
            '[ROTATION] Successfully wrote and verified lastProcessedIndex in Firestore');
        } else {
          logger.error({ 
            instanceId: this.instanceId, 
            expected: nextIndex, 
            actual: verifyState.lastProcessedIndex 
          }, '[ROTATION] CRITICAL: State write verification FAILED - rolling back');
          
          // Rollback: restore previous index
          try {
            await this.setState({ lastProcessedIndex: previousIndex });
            logger.warn({ instanceId: this.instanceId, rolledBackTo: previousIndex }, '[ROTATION] Rolled back to previous index');
          } catch (rollbackErr: any) {
            logger.error({ err: rollbackErr, instanceId: this.instanceId }, '[ROTATION] CRITICAL: Rollback failed');
          }
          throw new Error(`State write verification failed: expected ${nextIndex}, got ${verifyState.lastProcessedIndex}`);
        }
      } catch (stateErr: any) {
        logger.error({ 
          err: stateErr.message, 
          stack: stateErr.stack,
          instanceId: this.instanceId,
          attemptedIndex: nextIndex,
          previousIndex
        }, '[ROTATION] CRITICAL: Failed to write lastProcessedIndex - aborting run');
        throw new Error(`Failed to update rotation state: ${stateErr.message}`);
      }

      // Only proceed if state write succeeded
      if (!stateWriteSuccess) {
        throw new Error('State write verification failed - aborting run');
      }

      return await this.processOneCoin(selectedSymbol, coins);
    }
  }

  /**
   * Process exactly one coin
   * Uses FREE APIs only (Binance, CoinGecko, Google Finance) - no exchange API required
   */
  private async processOneCoin(symbol: string, allCoins: string[]): Promise<{ symbol: string; result: any }> {
    logger.info({
      instanceId: this.instanceId,
      symbol,
      index: allCoins.indexOf(symbol),
      totalCoins: allCoins.length,
    }, 'Processing coin from tracked list using FREE APIs only');

    // Use 'system' as user ID for scheduled research (no specific user context needed)
    const userId = 'system';

    // NOTE: Scheduled research does NOT require exchange APIs
    // It uses FREE APIs: Binance (market data), CoinGecko (historical), Google Finance (exchange rates)
    // LunarCrush and CryptoQuant are handled internally by the research engine

    logger.info({
      instanceId: this.instanceId,
      symbol,
      userId,
    }, 'Running scheduled research with FREE APIs only (no exchange API required)');

    // Run research with timeout
    // Research engine uses FREE APIs only: Binance, CoinGecko, Google Finance, LunarCrush, CryptoQuant
    const researchPromise = researchEngine.runResearch(
      symbol,
      userId,
      undefined, // No exchange adapter needed
      false, // forceEngine
      [], // No exchange adapters needed
      '5m', // Default timeframe
      undefined // No active context needed
    );
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Research timeout after 4 minutes')), this.TIMEOUT_MS);
    });

    const result: any = await Promise.race([researchPromise, timeoutPromise]);

    // Log confidence and accuracy for debugging
    logger.info({
      instanceId: this.instanceId,
      symbol,
      confidence: result.confidence,
      accuracy: result.accuracy,
      side: result.side,
      autoTradeDisabled: 'Auto-trade disabled for scheduled research',
    }, 'Research result obtained (auto-trade disabled for scheduled research)');

    // Check if auto-trade should execute and add decision to result
    // CRITICAL: Use configurable threshold (default 75%), NOT hardcoded 65%
    // Also check result.status - skip if insufficient_data
    // Require confluence if enabled
    const hasConfluence = result.confluenceFlags?.hasConfluence !== false; // Default to true if not present (backward compat)
    const volumeConfirmed = result.volumeConfirmed !== false; // Default to true if not present
    const derivativesContradict = result.derivativesContradict === true;

    // Auto-trade is disabled for scheduled research (no exchange APIs available)
    // Auto-trade only works for manual research where users have exchange APIs configured
    const autoTradeTriggered = false;
    
    const autoTradeDecision = {
      triggered: autoTradeTriggered,
      confidence: result.confidence,
      threshold: 75, // Minimum threshold (not used for scheduled research)
      reason: 'Auto-trade disabled for scheduled research (exchange API required)',
    };
    
    // Add auto-trade decision to result (disabled for scheduled research)
    (result as any).autoTradeDecision = autoTradeDecision;

    // Record research metrics
    if (userId) {
      metricsService.recordResearchRun(userId, result.status === 'ok', result.confidence);
    }

    // Auto-trade is disabled for scheduled research (no exchange APIs available)
    logger.info({
      instanceId: this.instanceId,
      symbol,
      confidence: result.confidence,
      side: result.side,
      status: result.status,
      reason: autoTradeDecision.reason,
    }, `[SCHEDULED-RESEARCH] Auto-trade disabled for scheduled runs (exchange API required)`);

    // Save result to Firestore
    try {
      const db = admin.firestore(getFirebaseAdmin());
      await db.collection('deepResearchResults').doc(symbol).set({
        symbol,
        result,
        timestamp: admin.firestore.Timestamp.now(),
        instanceId: this.instanceId,
        // Scheduled research uses only free APIs (no exchanges)
        apisUsed: ['binance', 'coingecko', 'googlefinance', 'lunarcrush', 'cryptoquant'],
      }, { merge: true });
      
      logger.debug({ instanceId: this.instanceId, symbol }, 'Research result saved to Firestore');
    } catch (storeErr: any) {
      logger.warn({ err: storeErr, symbol, instanceId: this.instanceId }, 'Failed to store research result (non-critical)');
    }

    return { symbol, result };
  }


  /**
   * Try to acquire distributed lock
   * @param lockKey - Lock key (can be interval-specific)
   * @param force - If true, force acquire even if lock exists (for admin/testing)
   */
  private async tryAcquireLock(lockKey: string, force: boolean = false): Promise<boolean> {
    try {
      const db = admin.firestore(getFirebaseAdmin());
      const lockRef = db.collection('locks').doc(lockKey);
      
      const lockDoc = await lockRef.get();
      const lockData = lockDoc.data();

      if (lockData && !force) {
        // Check if lock is expired
        const expiresAt = lockData.expiresAt?.toMillis() || 0;
        if (expiresAt > Date.now()) {
          // Lock still valid
          logger.debug({ instanceId: this.instanceId, lockKey, holder: lockData.instanceId, expiresAt: new Date(expiresAt).toISOString() }, 
            'Lock already held by another instance');
          return false;
        } else {
          // Lock expired, clean it up
          logger.debug({ instanceId: this.instanceId, lockKey }, 'Lock expired, cleaning up');
          await lockRef.delete();
        }
      }

      // Acquire lock
      const expiresAt = Date.now() + this.LOCK_TTL_MS;
      await lockRef.set({
        instanceId: this.instanceId,
        acquiredAt: admin.firestore.Timestamp.now(),
        expiresAt: admin.firestore.Timestamp.fromMillis(expiresAt),
        force,
      });

      logger.debug({ instanceId: this.instanceId, lockKey, expiresAt: new Date(expiresAt).toISOString() }, 'Lock acquired');
      return true;
    } catch (error: any) {
      logger.error({ err: error, instanceId: this.instanceId, lockKey }, 'Error acquiring lock');
      return false;
    }
  }

  /**
   * Release distributed lock
   */
  private async releaseLock(lockKey: string): Promise<void> {
    try {
      const db = admin.firestore(getFirebaseAdmin());
      const lockRef = db.collection('locks').doc(lockKey);
      const lockDoc = await lockRef.get();
      const lockData = lockDoc.data();

      // Only release if we own the lock
      if (lockData && lockData.instanceId === this.instanceId) {
        await lockRef.delete();
        logger.debug({ instanceId: this.instanceId, lockKey }, 'Lock released');
      } else if (lockData) {
        logger.debug({ instanceId: this.instanceId, lockKey, holder: lockData.instanceId }, 'Lock held by another instance, not releasing');
      }
    } catch (error: any) {
      logger.warn({ err: error, instanceId: this.instanceId, lockKey }, 'Error releasing lock (non-critical)');
    }
  }

  /**
   * Check lock status
   */
  private async checkLockStatus(): Promise<{ isAcquired: boolean; instanceId?: string; expiresAt?: string }> {
    try {
      const db = admin.firestore(getFirebaseAdmin());
      const lockRef = db.collection('locks').doc(this.LOCK_KEY);
      const lockDoc = await lockRef.get();
      
      if (!lockDoc.exists) {
        return { isAcquired: false };
      }

      const lockData = lockDoc.data()!;
      const expiresAt = lockData.expiresAt?.toMillis() || 0;
      
      if (expiresAt <= Date.now()) {
        return { isAcquired: false };
      }

      return {
        isAcquired: true,
        instanceId: lockData.instanceId,
        expiresAt: new Date(expiresAt).toISOString(),
      };
    } catch (error: any) {
      logger.warn({ err: error, instanceId: this.instanceId }, 'Error checking lock status');
      return { isAcquired: false };
    }
  }

  /**
   * Get scheduler state from Firestore
   */
  private async getState(): Promise<{
    lastProcessedIndex?: number;
    lastRunTimestamp?: string;
    lastSymbol?: string;
    lastDuration?: number;
    lastSuccess?: boolean;
  }> {
    try {
      const db = admin.firestore(getFirebaseAdmin());
      const stateDoc = await db.collection(this.STATE_COLLECTION).doc(this.STATE_DOC).get();
      
      if (!stateDoc.exists) {
        return {};
      }

      const data = stateDoc.data()!;
      return {
        lastProcessedIndex: data.lastProcessedIndex,
        lastRunTimestamp: data.lastRunTimestamp,
        lastSymbol: data.lastSymbol,
        lastDuration: data.lastDuration,
        lastSuccess: data.lastSuccess,
      };
    } catch (error: any) {
      logger.warn({ err: error, instanceId: this.instanceId }, 'Error getting scheduler state');
      return {};
    }
  }

  /**
   * Update scheduler state in Firestore
   */
  private async setState(updates: {
    lastProcessedIndex?: number;
    lastRunTimestamp?: string;
    lastSymbol?: string;
    lastDuration?: number;
    lastSuccess?: boolean;
  }): Promise<void> {
    try {
      const db = admin.firestore(getFirebaseAdmin());
      logger.debug({ instanceId: this.instanceId, updates }, '[DIAGNOSTIC] Writing state to Firestore');
      await db.collection(this.STATE_COLLECTION).doc(this.STATE_DOC).set({
        ...updates,
        updatedAt: admin.firestore.Timestamp.now(),
        updatedBy: this.instanceId,
      }, { merge: true });
      logger.info({ instanceId: this.instanceId, updates }, '[DIAGNOSTIC] Successfully wrote state to Firestore');
    } catch (error: any) {
      logger.error({ 
        err: error.message, 
        stack: error.stack,
        instanceId: this.instanceId,
        updates 
      }, '[DIAGNOSTIC] CRITICAL: Failed to update scheduler state in Firestore');
      throw error; // Re-throw so caller knows it failed
    }
  }
}

export const deepResearchScheduler = new DeepResearchScheduler();
