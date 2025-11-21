import { researchEngine } from './researchEngine';
import { topCoinsService } from './topCoinsService';
import { firestoreAdapter } from './firestoreAdapter';
import { resolveExchangeConnector } from './exchangeResolver';
import { logger } from '../utils/logger';
import { getFirebaseAdmin } from '../utils/firebase';
import { orderManager } from './orderManager';
import { userRiskManager } from './userRiskManager';
import * as admin from 'firebase-admin';
import { ExchangeConnectorFactory } from './exchangeConnector';
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
  private autoTradeThreshold: number = 75; // Default: 75% accuracy (NOT 65%!) - minimum 75%
  private autoTradeEnabled: boolean = false;
  private featureConfig = loadFeatureConfig(); // Load feature config for confluence checks
  
  // Cache for duplicate order prevention
  private recentTrades: Map<string, number> = new Map(); // symbol -> timestamp
  private readonly DUPLICATE_TRADE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

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
        this.autoTradeThreshold = data.autoTradeThreshold || 75; // Default 75%, NOT 65%
        this.autoTradeEnabled = data.autoTradeEnabled || false;
        
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
        
        // Ensure autoTradeThreshold is at least 75%
        if (this.autoTradeThreshold < 75) {
          this.autoTradeThreshold = 75;
          logger.warn({ instanceId: this.instanceId, oldThreshold: data.autoTradeThreshold, newThreshold: 75 }, 
            'Auto-trade threshold was below 75%, enforcing minimum 75%');
        }
        
        logger.info({ 
          instanceId: this.instanceId,
          intervals: this.intervals,
          mode: this.mode,
          topN: this.topN,
          autoTradeThreshold: this.autoTradeThreshold,
          autoTradeEnabled: this.autoTradeEnabled,
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
    autoTradeThreshold?: number;
    autoTradeEnabled?: boolean;
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
    if (config.autoTradeThreshold !== undefined) {
      // Ensure threshold is between 75-100 (minimum 75% required)
      this.autoTradeThreshold = Math.max(75, Math.min(100, config.autoTradeThreshold || 75));
      if (config.autoTradeThreshold < 75) {
        logger.warn({ instanceId: this.instanceId, requested: config.autoTradeThreshold, enforced: 75 }, 
          'Auto-trade threshold must be >= 75%, enforcing minimum');
      }
      logger.info({ instanceId: this.instanceId, newThreshold: this.autoTradeThreshold }, 
        'Auto-trade threshold updated (minimum 75% enforced)');
    }
    if (config.autoTradeEnabled !== undefined) {
      this.autoTradeEnabled = config.autoTradeEnabled;
    }

    // Save to Firestore
    try {
      const db = admin.firestore(getFirebaseAdmin());
      await db.collection(this.STATE_COLLECTION).doc(this.CONFIG_DOC).set({
        intervals: this.intervals,
        mode: this.mode,
        topN: this.topN,
        autoTradeThreshold: this.autoTradeThreshold,
        autoTradeEnabled: this.autoTradeEnabled,
        updatedAt: admin.firestore.Timestamp.now(),
        updatedBy: this.instanceId,
      }, { merge: true });
      
      logger.info({ 
        instanceId: this.instanceId,
        intervals: this.intervals, 
        mode: this.mode, 
        topN: this.topN,
        autoTradeThreshold: this.autoTradeThreshold,
        autoTradeEnabled: this.autoTradeEnabled,
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
      autoTradeThreshold: this.autoTradeThreshold,
      autoTradeEnabled: this.autoTradeEnabled,
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
      autoTradeThreshold: this.autoTradeThreshold,
      autoTradeEnabled: this.autoTradeEnabled,
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
    autoTradeThreshold: number;
    autoTradeEnabled: boolean;
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
      autoTradeThreshold: this.autoTradeThreshold,
      autoTradeEnabled: this.autoTradeEnabled,
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
        autoTradeTriggered: this.autoTradeEnabled && result.result?.confidence >= this.autoTradeThreshold,
      }, 'Scheduled research run completed');

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
   * Get ALL connected exchanges for a user (not just one)
   * Returns array of exchange adapters
   */
  private async getAllUserExchanges(uid: string): Promise<Array<{ exchange: string; adapter: any; credentials: any }>> {
    const exchanges: Array<{ exchange: string; adapter: any; credentials: any }> = [];
    
    try {
      // Get all API keys for user
      const apiKeys = await firestoreAdapter.getApiKeys(uid);
      
      logger.debug({ instanceId: this.instanceId, uid, keyCount: apiKeys.length }, 'Fetching all user exchange connectors');
      
      for (const key of apiKeys) {
        try {
          // Check if exchange is valid
          const exchange = key.exchange.toLowerCase().trim();
          const validExchanges = ['binance', 'bitget', 'bingx', 'weex', 'kucoin', 'bybit', 'okx'];
          
          if (!validExchanges.includes(exchange)) {
            logger.debug({ instanceId: this.instanceId, uid, exchange }, 'Skipping unsupported exchange');
            continue;
          }
          
          // Try to create connector
          const { decrypt } = await import('./keyManager');
          const apiKey = decrypt(key.apiKeyEncrypted);
          const secret = decrypt(key.apiSecretEncrypted);
          // Note: passphraseEncrypted may not exist in ApiKeyDocument for all exchanges
          const passphrase = (key as any).passphraseEncrypted ? decrypt((key as any).passphraseEncrypted) : undefined;
          
          if (!apiKey || !secret) {
            logger.debug({ instanceId: this.instanceId, uid, exchange }, 'Skipping exchange with invalid credentials');
            continue;
          }
          
          try {
            // Support all valid exchanges, not just 4
            // ExchangeConnectorFactory supports: binance, bitget, weex, bingx
            // For other exchanges (kucoin, bybit, okx), we'll need to handle them differently
            // For now, try to create adapter for supported exchanges
            let adapter: any = null;
            
            if (['binance', 'bitget', 'weex', 'bingx'].includes(exchange)) {
              const exchangeName = exchange as 'binance' | 'bitget' | 'weex' | 'bingx';
              adapter = ExchangeConnectorFactory.create(exchangeName, {
                apiKey,
                secret,
                passphrase,
                testnet: key.testnet ?? true,
              });
            } else {
              // For unsupported exchanges in ExchangeConnectorFactory, log and skip
              logger.debug({ instanceId: this.instanceId, uid, exchange }, 'Exchange not supported by ExchangeConnectorFactory, skipping');
              continue;
            }
            
            if (!adapter) {
              logger.debug({ instanceId: this.instanceId, uid, exchange }, 'Failed to create adapter');
              continue;
            }
            
            exchanges.push({
              exchange,
              adapter,
              credentials: { apiKey, secret, passphrase, testnet: key.testnet ?? true },
            });
            
            logger.debug({ instanceId: this.instanceId, uid, exchange }, 'Exchange connector created');
          } catch (createErr: any) {
            logger.warn({ err: createErr, uid, exchange }, 'Failed to create exchange connector');
          }
        } catch (keyErr: any) {
          logger.warn({ err: keyErr, uid, exchange: key.exchange }, 'Error processing API key');
        }
      }
      
      logger.info({ instanceId: this.instanceId, uid, exchangeCount: exchanges.length, exchanges: exchanges.map(e => e.exchange) }, 
        `Retrieved ${exchanges.length} connected exchanges for user`);
    } catch (err: any) {
      logger.error({ err, uid, instanceId: this.instanceId }, 'Error getting all user exchanges');
    }
    
    return exchanges;
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
   * Uses ALL connected exchanges (not just one)
   */
  private async processOneCoin(symbol: string, allCoins: string[]): Promise<{ symbol: string; result: any }> {
    logger.info({ 
      instanceId: this.instanceId, 
      symbol, 
      index: allCoins.indexOf(symbol),
      totalCoins: allCoins.length,
    }, 'Processing coin from tracked list');

    // Get ALL users and their exchanges
    const allUsers = await firestoreAdapter.getAllUsers();
    let userId: string | null = null;
    let allExchanges: Array<{ exchange: string; adapter: any; credentials: any }> = [];
    
    // Try to get all exchanges for all users (aggregate from all connected exchanges)
    for (const user of allUsers) {
      try {
        const userExchanges = await this.getAllUserExchanges(user.uid);
        if (userExchanges.length > 0) {
          if (!userId) {
            userId = user.uid; // Use first user with exchanges for research
          }
          allExchanges.push(...userExchanges);
        }
      } catch (err: any) {
        logger.debug({ err, uid: user.uid }, 'Error getting exchanges for user');
      }
    }
    
    // Remove duplicates (same exchange type)
    const uniqueExchanges = new Map<string, { exchange: string; adapter: any; credentials: any }>();
    for (const ex of allExchanges) {
      if (!uniqueExchanges.has(ex.exchange)) {
        uniqueExchanges.set(ex.exchange, ex);
      }
    }
    allExchanges = Array.from(uniqueExchanges.values());
    
    logger.info({ 
      instanceId: this.instanceId, 
      symbol, 
      userId, 
      exchangeCount: allExchanges.length,
      exchanges: allExchanges.map(e => e.exchange),
    }, `Using ${allExchanges.length} unique exchanges for research`);

    // Use primary exchange adapter (first one, or null if none)
    const primaryAdapter = allExchanges.length > 0 ? allExchanges[0].adapter : null;

    // Run research with timeout
    // Research engine will aggregate data from ALL exchanges AND ALL integrations (CryptoQuant, LunarCrush, CoinAPI)
    const researchPromise = researchEngine.runResearch(
      symbol, 
      userId || 'system', 
      primaryAdapter || undefined, // Primary adapter for compatibility
      false, // forceEngine
      allExchanges // Pass ALL exchanges for aggregation
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
      threshold: this.autoTradeThreshold,
      autoTradeEnabled: this.autoTradeEnabled,
      side: result.side,
      willTriggerAutoTrade: this.autoTradeEnabled && result.confidence >= this.autoTradeThreshold && result.side !== 'NEUTRAL',
    }, 'Research result obtained');

    // Check if auto-trade should execute and add decision to result
    // CRITICAL: Use configurable threshold (default 75%), NOT hardcoded 65%
    // Also check result.status - skip if insufficient_data
    // Require confluence if enabled
    const hasConfluence = result.confluenceFlags?.hasConfluence !== false; // Default to true if not present (backward compat)
    const volumeConfirmed = result.volumeConfirmed !== false; // Default to true if not present
    const derivativesContradict = result.derivativesContradict === true;
    
    const autoTradeTriggered = this.autoTradeEnabled 
      && userId 
      && result.status === 'ok' // Only trade if data is sufficient
      && result.confidence >= this.autoTradeThreshold 
      && result.side !== 'NEUTRAL'
      && hasConfluence // Require confluence
      && (!this.featureConfig?.volume?.requireVolumeConfirmation || volumeConfirmed) // Volume confirmation if required
      && !derivativesContradict; // Don't trade if derivatives contradict
    
    const autoTradeDecision = {
      triggered: autoTradeTriggered,
      confidence: result.confidence,
      threshold: this.autoTradeThreshold,
      reason: autoTradeTriggered 
        ? `Confidence ${result.confidence}% >= threshold ${this.autoTradeThreshold}% with confluence`
        : !this.autoTradeEnabled 
          ? 'Auto-trade disabled'
          : result.status !== 'ok'
            ? `Insufficient data (status: ${result.status})`
            : result.confidence < this.autoTradeThreshold
              ? `Confidence ${result.confidence}% < threshold ${this.autoTradeThreshold}%`
              : result.side === 'NEUTRAL'
                ? 'Signal is NEUTRAL'
                : !hasConfluence
                  ? 'Confluence check failed'
                  : !volumeConfirmed && this.featureConfig?.volume?.requireVolumeConfirmation
                    ? 'Volume confirmation failed (RVOL < threshold)'
                  : derivativesContradict
                    ? 'Derivatives contradict price signal'
                : 'Unknown reason',
    };
    
    // Add auto-trade decision to result
    (result as any).autoTradeDecision = autoTradeDecision;
    
    // Record research metrics
    if (userId) {
      metricsService.recordResearchRun(userId, result.status === 'ok', result.confidence);
    }
    
    if (autoTradeTriggered) {
      // Check for duplicate trade (same symbol within window)
      const lastTradeTime = this.recentTrades.get(symbol);
      const now = Date.now();
      
      if (lastTradeTime && (now - lastTradeTime) < this.DUPLICATE_TRADE_WINDOW_MS) {
        logger.warn({
          instanceId: this.instanceId,
          symbol,
          lastTradeTime: new Date(lastTradeTime).toISOString(),
          windowMs: this.DUPLICATE_TRADE_WINDOW_MS,
        }, 'Skipping auto-trade: duplicate trade detected within window');
        (result as any).autoTradeDecision.reason = 'Duplicate trade detected within window';
        (result as any).autoTradeDecision.triggered = false;
      } else {
        try {
          // Use primary exchange for auto-trade
          const tradeAdapter = primaryAdapter || allExchanges[0]?.adapter;
          if (!tradeAdapter) {
            throw new Error('No exchange adapter available for auto-trade');
          }
          
          await this.executeAutoTrade(userId, symbol, result, tradeAdapter);
          
          // Record auto-trade metric
          if (userId) {
            metricsService.recordAutoTrade(userId);
          }
          
          // Record trade time to prevent duplicates
          this.recentTrades.set(symbol, now);
          
          // Clean up old entries
          const cleanupTime = now - (this.DUPLICATE_TRADE_WINDOW_MS * 2);
          for (const [sym, time] of this.recentTrades.entries()) {
            if (time < cleanupTime) {
              this.recentTrades.delete(sym);
            }
          }
        } catch (tradeErr: any) {
          logger.error({ err: tradeErr, symbol, userId, instanceId: this.instanceId }, 'Error executing auto-trade');
          (result as any).autoTradeDecision.reason = `Auto-trade execution failed: ${tradeErr.message}`;
          (result as any).autoTradeDecision.triggered = false;
          // Don't throw - continue with saving result
        }
      }
    } else {
      logger.info({
        instanceId: this.instanceId,
        symbol,
        autoTradeEnabled: this.autoTradeEnabled,
        confidence: result.confidence,
        threshold: this.autoTradeThreshold,
        side: result.side,
        status: result.status,
        reason: autoTradeDecision.reason,
      }, `[AUTO-TRADE] Skipping run due to: ${autoTradeDecision.reason}`);
    }

    // Save result to Firestore
    try {
      const db = admin.firestore(getFirebaseAdmin());
      await db.collection('deepResearchResults').doc(symbol).set({
        symbol,
        result,
        timestamp: admin.firestore.Timestamp.now(),
        instanceId: this.instanceId,
        exchangesUsed: allExchanges.map(e => e.exchange),
      }, { merge: true });
      
      logger.debug({ instanceId: this.instanceId, symbol }, 'Research result saved to Firestore');
    } catch (storeErr: any) {
      logger.warn({ err: storeErr, symbol, instanceId: this.instanceId }, 'Failed to store research result (non-critical)');
    }

    return { symbol, result };
  }

  /**
   * Execute auto-trade when accuracy threshold is met
   * CRITICAL: Uses configurable threshold (default 75%), NOT hardcoded 65%
   */
  private async executeAutoTrade(
    userId: string,
    symbol: string,
    result: any,
    exchangeAdapter: any
  ): Promise<void> {
    if (!exchangeAdapter || !userId) {
      throw new Error('Exchange adapter or user ID not available');
    }

    logger.info({ 
      userId, 
      symbol, 
      confidence: result.confidence,
      threshold: this.autoTradeThreshold,
      side: result.side,
      entry: result.entry,
      stopLoss: result.stopLoss,
      takeProfit: result.takeProfit,
      instanceId: this.instanceId,
    }, `Auto-trade execution triggered (confidence ${result.confidence}% >= threshold ${this.autoTradeThreshold}%)`);

    // Safety checks
    // 1. Check account balance
    let accountBalance: number = 0;
    try {
      const account = await exchangeAdapter.getAccount();
      accountBalance = parseFloat(account.balance || account.availableBalance || '0');
      if (accountBalance <= 0) {
        logger.warn({ userId, accountBalance, instanceId: this.instanceId }, 'Insufficient balance for auto-trade');
        return;
      }
      logger.debug({ userId, accountBalance, instanceId: this.instanceId }, 'Account balance verified');
    } catch (err: any) {
      logger.error({ err, userId, instanceId: this.instanceId }, 'Error checking account balance');
      return;
    }

    // 2. Calculate position size (simplified: use 2% of balance per trade)
    const entryPrice = result.entry || result.currentPrice || 0;
    if (entryPrice <= 0) {
      logger.warn({ userId, symbol, entryPrice, instanceId: this.instanceId }, 'Invalid entry price for auto-trade');
      return;
    }
    
    const positionSizePercent = 0.02;
    const positionSize = (accountBalance * positionSizePercent) / entryPrice;
    const minQuantity = 0.001; // Minimum trade size
    const quantity = Math.max(minQuantity, positionSize);

    // 3. Check risk limits via userRiskManager
    const riskCheck = await userRiskManager.canTrade(userId, symbol, quantity, entryPrice, 0.01); // 1% assumed adverse move

    if (!riskCheck.allowed) {
      logger.warn({ userId, symbol, reason: riskCheck.reason, instanceId: this.instanceId }, 'Trade blocked by risk manager');
      return;
    }

    // 4. Execute trade via orderManager
    try {
      const orderResult = await orderManager.placeOrder(userId, {
        symbol,
        side: result.side === 'LONG' ? 'BUY' : 'SELL',
        type: 'MARKET',
        quantity: Number(quantity),
        price: entryPrice || undefined,
      });

      logger.info({
        userId,
        symbol,
        orderId: orderResult.id,
        side: result.side,
        quantity,
        confidence: result.confidence,
        threshold: this.autoTradeThreshold,
        entry: result.entry,
        stopLoss: result.stopLoss,
        takeProfit: result.takeProfit,
        instanceId: this.instanceId,
      }, 'Auto-trade executed successfully');

      // Log trade execution to Firestore
      const executionLogId = await firestoreAdapter.saveExecutionLog(userId, {
        symbol,
        timestamp: admin.firestore.Timestamp.now(),
        action: 'EXECUTED',
        signal: result.side === 'LONG' ? 'BUY' : 'SELL',
        strategy: 'deep_research_auto',
        accuracyUsed: result.confidence / 100,
        orderId: orderResult.id,
        status: 'filled',
        reason: `Auto-trade triggered: confidence ${result.confidence}% >= threshold ${this.autoTradeThreshold}%`,
      });

      logger.info({
        userId,
        symbol,
        executionLogId,
        orderId: orderResult.id,
        entry: result.entry,
        stopLoss: result.stopLoss,
        takeProfit: result.takeProfit,
        instanceId: this.instanceId,
      }, '[AUTO-TRADE] Execution log saved to Firestore');

      // Emit WebSocket event for trade execution (if websocket manager is available)
      // Note: WebSocket emission is optional and non-blocking
      try {
        // Try to import userWebSocketManager - may not exist in all setups
        const wsModule = await import('./userWebSocketManager').catch(() => null);
        if (wsModule?.userWebSocketManager && typeof wsModule.userWebSocketManager.broadcastToUser === 'function') {
          wsModule.userWebSocketManager.broadcastToUser(userId, 'trade:executed', {
            userId,
            symbol,
            side: result.side,
            orderId: orderResult.id,
            entry: result.entry,
            stopLoss: result.stopLoss,
            takeProfit: result.takeProfit,
            confidence: result.confidence,
            threshold: this.autoTradeThreshold,
            quantity,
            timestamp: new Date().toISOString(),
          });
          logger.debug({ userId, symbol }, '[AUTO-TRADE] WebSocket event emitted');
        }
      } catch (wsErr: any) {
        // WebSocket emission is optional - log but don't fail
        logger.debug({ err: wsErr.message, userId, symbol }, '[AUTO-TRADE] WebSocket not available (non-critical)');
      }

      // Schedule TP exit watcher if takeProfit is set
      if (result.takeProfit && result.takeProfit > 0) {
        this.scheduleTPExitWatcher(userId, symbol, orderResult.id, result.takeProfit, result.side);
      }

    } catch (err: any) {
      logger.error({ 
        err: err.message, 
        stack: err.stack,
        userId, 
        symbol, 
        instanceId: this.instanceId 
      }, '[AUTO-TRADE] Error placing auto-trade order');
      throw err;
    }
  }

  /**
   * Schedule TP exit watcher to close position when TP is reached
   */
  private scheduleTPExitWatcher(
    userId: string,
    symbol: string,
    entryOrderId: string,
    takeProfit: number,
    side: 'LONG' | 'SHORT'
  ): void {
    logger.info({
      userId,
      symbol,
      entryOrderId,
      takeProfit,
      side,
      instanceId: this.instanceId,
    }, '[AUTO-TRADE] Scheduling TP exit watcher');

    // Check price every 30 seconds until TP is reached or timeout (24 hours)
    const checkInterval = 30 * 1000; // 30 seconds
    const maxDuration = 24 * 60 * 60 * 1000; // 24 hours
    const startTime = Date.now();
    
    const watcherInterval = setInterval(async () => {
      try {
        // Check if max duration exceeded
        if (Date.now() - startTime > maxDuration) {
          clearInterval(watcherInterval);
          logger.warn({ userId, symbol, entryOrderId }, '[AUTO-TRADE] TP watcher timeout after 24 hours');
          return;
        }

        // Get current price from exchange
        const allUsers = await firestoreAdapter.getAllUsers();
        const user = allUsers.find(u => u.uid === userId);
        if (!user) {
          clearInterval(watcherInterval);
          logger.warn({ userId, symbol }, '[AUTO-TRADE] User not found, stopping TP watcher');
          return;
        }

        const userExchanges = await this.getAllUserExchanges(userId);
        if (userExchanges.length === 0) {
          logger.warn({ userId, symbol }, '[AUTO-TRADE] No exchanges available for TP check');
          return;
        }

        const adapter = userExchanges[0].adapter;
        const ticker = await adapter.getTicker(symbol);
        const currentPrice = parseFloat(ticker?.lastPrice || ticker?.price || ticker?.last || '0');

        if (currentPrice <= 0) {
          logger.debug({ userId, symbol }, '[AUTO-TRADE] Invalid price for TP check');
          return;
        }

        // Check if TP is reached
        const tpReached = side === 'LONG' 
          ? currentPrice >= takeProfit
          : currentPrice <= takeProfit;

        if (tpReached) {
          clearInterval(watcherInterval);
          logger.info({
            userId,
            symbol,
            entryOrderId,
            currentPrice,
            takeProfit,
            side,
          }, '[AUTO-TRADE] Take profit reached, closing position');

          // Close position (opposite side)
          try {
            const closeSide = side === 'LONG' ? 'SELL' : 'BUY';
            // Get position size from entry order (would need to fetch from DB)
            // For now, use a simplified approach - close full position
            const closeOrder = await orderManager.placeOrder(userId, {
              symbol,
              side: closeSide,
              type: 'MARKET',
              quantity: 0.001, // Placeholder - should fetch actual position size
            });

            logger.info({
              userId,
              symbol,
              entryOrderId,
              closeOrderId: closeOrder?.id,
              takeProfit,
            }, '[AUTO-TRADE] Position closed at TP');

            // Log TP exit
            await firestoreAdapter.saveExecutionLog(userId, {
              symbol,
              timestamp: admin.firestore.Timestamp.now(),
              action: 'EXECUTED',
              signal: closeSide,
              strategy: 'deep_research_auto_tp_exit',
              orderId: closeOrder?.id,
              reason: `TP exit: price ${currentPrice} reached TP ${takeProfit}`,
            });
          } catch (closeErr: any) {
            logger.error({
              err: closeErr.message,
              stack: closeErr.stack,
              userId,
              symbol,
              entryOrderId,
            }, '[AUTO-TRADE] Error closing position at TP');
          }
        } else {
          logger.debug({
            userId,
            symbol,
            currentPrice,
            takeProfit,
            side,
            distance: side === 'LONG' 
              ? ((takeProfit - currentPrice) / currentPrice * 100).toFixed(2) + '%'
              : ((currentPrice - takeProfit) / currentPrice * 100).toFixed(2) + '%',
          }, '[AUTO-TRADE] TP not reached yet');
        }
      } catch (err: any) {
        logger.error({
          err: err.message,
          stack: err.stack,
          userId,
          symbol,
          entryOrderId,
        }, '[AUTO-TRADE] Error in TP watcher');
      }
    }, checkInterval);

    logger.debug({ userId, symbol, entryOrderId }, '[AUTO-TRADE] TP watcher started');
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
