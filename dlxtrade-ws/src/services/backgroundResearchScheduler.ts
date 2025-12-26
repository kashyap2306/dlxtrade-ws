import { logger } from '../utils/logger';
import { firestoreAdapter } from './firestoreAdapter';
import { runFreeModeDeepResearch } from './deepResearchEngine';
import { telegramService } from './telegramService';
import { autoTradeEngine } from './autoTradeEngine';
import { getFirebaseAdmin } from '../utils/firebase';
import { getUserIntegrationsByUid } from '../routes/users/providerConfig';
import * as admin from 'firebase-admin';
import {
  safeSetInterval,
  shouldRunBackgroundTasks,
  withTimeout,
  yieldToEventLoop,
  safeExternalCall,
  runBackgroundTask
} from '../utils/safeBackgroundRunner';

interface UserJobState {
  isRunning: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  mode?: 'TELEGRAM_BACKGROUND_RESEARCH' | 'AUTO_TRADE_RESEARCH';
}

// Research modes
const RESEARCH_MODE = {
  TELEGRAM_BACKGROUND_RESEARCH: 'TELEGRAM_BACKGROUND_RESEARCH',
  AUTO_TRADE_RESEARCH: 'AUTO_TRADE_RESEARCH'
} as const;

export class BackgroundResearchScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private userIntervals: Map<string, NodeJS.Timeout> = new Map();
  private userJobStates: Map<string, UserJobState> = new Map();
  private readonly COOLDOWN_MINUTES = 1; // Minimum minutes between alerts for same coin
  // CRITICAL: Track decryption failures per user to prevent retry loops
  // Maps uid -> { lastFailureTime, failureCount, disabled }
  private decryptionFailureCache: Map<string, { lastFailureTime: Date; failureCount: number; disabled: boolean }> = new Map();

  /**
   * Start the background research scheduler
   * 
   * LIFECYCLE DOCUMENTATION:
   * - Starts automatically on server startup (server.ts line 254)
   * - Runs server-side independently of frontend
   * - Survives user logout, tab close, or browser shutdown
   * - Does NOT depend on WebSocket connections, frontend polling, or UI presence
   * - Uses safeSetInterval for event loop protection
   * - Checks for enabled users every 60 seconds
   * - Each user's research runs at their configured frequency (researchFrequencyMinutes)
   * 
   * EXECUTION FLOW:
   * 1. Server starts → backgroundResearchScheduler.start() called
   * 2. Bootstrap enabled users from Firestore
   * 3. Every 60s: checkAndScheduleUserResearch() scans all users
   * 4. For each enabled user: schedule processUserResearch() at configured frequency
   * 5. processUserResearch() runs research and sends Telegram alerts if threshold met
   * 
   * REFACTORED: Uses safe background runner to prevent event loop blocking
   */
  start() {
    // 🔥 HARD LOG: Scheduler startup
    console.log('🔥 [HARD_LOG] [SCHEDULER_START] Background research scheduler start() called');
    logger.info({ timestamp: new Date().toISOString() }, '🔥 [HARD_LOG] [SCHEDULER_START] Background research scheduler start() called');

    // Check env flag first
    if (process.env.DISABLE_AUTOTRADE === 'true') {
      logger.warn('Background research scheduler DISABLED by env flag');
      console.log('🛑 [AUTO-TRADE LOOP] Background research scheduler DISABLED by DISABLE_AUTOTRADE=true');
      console.log('🛑 [AUTO-TRADE LOOP] Auto-trade execution loop will NOT run');
      console.log('🔥 [HARD_LOG] [SCHEDULER_BLOCKED] Scheduler blocked by DISABLE_AUTOTRADE=true');
      return;
    }

    if (this.isRunning) {
      logger.warn('Background research scheduler is already running');
      console.log('[AUTO-TRADE LOOP] Scheduler already running, skipping start');
      console.log('🔥 [HARD_LOG] [SCHEDULER_ALREADY_RUNNING] Scheduler already running, skipping start');
      return;
    }
    this.isRunning = true;
    console.log('🔥 [HARD_LOG] [SCHEDULER_RUNNING] Scheduler isRunning set to true');
    logger.info({
      schedulerRunning: this.isRunning,
      schedulerImmortal: true,
      checkIntervalSeconds: 60,
      willRunContinuously: true
    }, '✅ [SCHEDULER_IMMORTAL] Background research scheduler started - SERVER-SIDE ONLY (independent of frontend) - IMMORTAL MODE');
    console.log('[AUTO-TRADE LOOP] ✅ Background research scheduler started - execution loop is ACTIVE - IMMORTAL MODE');
    console.log('[AUTO-TRADE LOOP]    - Runs server-side independently of frontend');
    console.log('[AUTO-TRADE LOOP]    - Survives user logout, tab close, browser shutdown');
    console.log('[AUTO-TRADE LOOP]    - NO frontend dependencies (WebSocket, polling, or UI presence)');
    console.log('[AUTO-TRADE LOOP]    - IMMORTAL: Will run continuously until manually disabled');

    // Bootstrap: Load all enabled users immediately on startup (non-blocking)
    console.log('🔥 [HARD_LOG] [BOOTSTRAP_START] Starting bootstrapEnabledUsers()');
    runBackgroundTask(
      () => this.bootstrapEnabledUsers(),
      'scheduler-bootstrap',
      30000 // 30s timeout for bootstrap
    ).catch((err: any) => {
      logger.error({ error: err?.message }, '❌ [SCHEDULER] Bootstrap failed, continuing with periodic checks');
      console.log('🔥 [HARD_LOG] [BOOTSTRAP_ERROR] Bootstrap failed:', err?.message);
    });

    // Check for users with enabled background research every minute
    // REFACTORED: Use safeSetInterval for event loop protection
    // CRITICAL: This runs server-side, independent of frontend
    // CRITICAL: This interval is IMMORTAL - it will continuously check and reschedule users
    console.log('🔥 [HARD_LOG] [INTERVAL_CREATE] Creating main scheduler interval (60s)');
    this.intervalId = safeSetInterval(
      async () => {
        console.log('🔥 [HARD_LOG] [INTERVAL_TICK] Main scheduler interval tick - checking users');
        logger.debug({
          schedulerRunning: this.isRunning,
          activeUserIntervals: this.userIntervals.size,
          activeJobStates: this.userJobStates.size
        }, '🔄 [SCHEDULER_IMMORTAL] Periodic check cycle starting - verifying all enabled users are scheduled');
        await this.checkAndScheduleUserResearchSafe();
      },
      60 * 1000,
      'scheduler-check-users'
    );
    console.log('🔥 [HARD_LOG] [INTERVAL_CREATED] Main scheduler interval created, intervalId:', !!this.intervalId);

    logger.info({
      intervalId: this.intervalId ? 'created' : 'null',
      checkIntervalMs: 60000,
      schedulerImmortal: true
    }, '✅ [SCHEDULER_IMMORTAL] Main scheduler interval created - will run continuously every 60 seconds');

    // 🔥 DEBUG: Log scheduler startup confirmation
    logger.info({
      schedulerRunning: this.isRunning,
      intervalId: !!this.intervalId,
      serverSide: true,
      frontendIndependent: true
    }, '🔍 [SCHEDULER_LIFECYCLE_DEBUG] Background Research Scheduler started - server-side only');
  }

  /**
   * Safe wrapper for checkAndScheduleUserResearch
   */
  private async checkAndScheduleUserResearchSafe(): Promise<void> {
    console.log('🔥 [HARD_LOG] [CHECK_START] checkAndScheduleUserResearchSafe() called');
    if (!shouldRunBackgroundTasks()) {
      logger.debug('Skipping user research check - background tasks paused');
      console.log('🔥 [HARD_LOG] [CHECK_BLOCKED] Background tasks paused, skipping check');
      return;
    }

    try {
      console.log('⏰ [SCHEDULER_HEARTBEAT] Research Scheduler Active - Checking users...');
      console.log('🔥 [HARD_LOG] [CHECK_EXECUTING] Calling checkAndScheduleUserResearch()');
      await withTimeout(
        () => this.checkAndScheduleUserResearch(),
        10000, // 10s timeout
        'check-schedule-users'
      );
      console.log('🔥 [HARD_LOG] [CHECK_COMPLETE] checkAndScheduleUserResearch() completed');
    } catch (err: any) {
      logger.warn({ error: err.message }, 'User research check timed out');
      console.log('🔥 [HARD_LOG] [CHECK_ERROR] checkAndScheduleUserResearch() error:', err?.message);
    }
  }

  /**
   * Bootstrap: Load ALL users with backgroundResearchEnabled === true on server start
   * CRITICAL: This ensures scheduler survives server restarts
   */
  private async bootstrapEnabledUsers() {
    try {
      logger.info('🔄 [SCHEDULER] Bootstrapping enabled users on startup...');

      const db = getFirebaseAdmin().firestore();
      const usersSnapshot = await db.collection('users').get();

      let enabledCount = 0;
      let registeredCount = 0;

      // Check each user's background research settings
      for (const userDoc of usersSnapshot.docs) {
        // Yield to event loop periodically to prevent blocking API endpoints
        await yieldToEventLoop();

        const uid = userDoc.id;

        try {
          // CRITICAL: Skip system/internal UIDs
          if (this.isSystemUid(uid)) {
            logger.info({ uid }, '⏭️ [SCHEDULER] Skipping system UID for background research');
            continue;
          }

          // Check both auto-trade and Telegram background research
          const autoTradeConfigDoc = await db.collection('users').doc(uid).collection('autoTradeConfig').doc('current').get();
          const autoTradeConfig = autoTradeConfigDoc.exists ? autoTradeConfigDoc.data() : null;
          const autoTradeEnabled = autoTradeConfig?.autoTradeEnabled === true;

          const settings = await firestoreAdapter.getBackgroundResearchSettings(uid);
          // Check explicit telegramBackgroundResearchEnabled flag
          const telegramBgResearchEnabled = settings?.telegramBackgroundResearchEnabled === true ||
            (settings?.backgroundResearchEnabled === true && settings?.telegramBackgroundResearchEnabled !== false);

          // Bootstrap if either mode is enabled
          if (autoTradeEnabled || telegramBgResearchEnabled) {
            enabledCount++;
            logger.info({ uid, autoTradeEnabled, telegramBgResearchEnabled }, '📋 [SCHEDULER] Found enabled user during bootstrap');

            // CRITICAL: Use ensureUserResearchScheduled for hard guarantee during bootstrap
            const scheduleResult = await this.ensureUserResearchScheduled(uid);
            if (scheduleResult.scheduled) {
              registeredCount++;
              logger.info({ uid }, '✅ [SCHEDULER] User registered during bootstrap');
            } else {
              logger.warn({ uid, reason: scheduleResult.reason }, '⚠️ [SCHEDULER] User registration failed during bootstrap');
            }
          }
        } catch (userErr: any) {
          logger.warn({ uid, error: userErr.message }, '⚠️ [SCHEDULER] Error checking user during bootstrap, skipping');
        }
      }

      logger.info({
        totalUsers: usersSnapshot.docs.length,
        enabledUsers: enabledCount,
        registeredUsers: registeredCount
      }, '✅ [SCHEDULER] Bootstrap completed - enabled users registered');
    } catch (error: any) {
      logger.error({ error: error.message, stack: error.stack }, '❌ [SCHEDULER] Error during bootstrap');
      throw error;
    }
  }

  /**
   * Stop the background research scheduler
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // Clear all user-specific intervals
    for (const [uid, intervalId] of this.userIntervals.entries()) {
      clearInterval(intervalId);
      logger.debug({ uid }, 'User research interval cleared');
    }
    this.userIntervals.clear();
    this.userJobStates.clear();

    this.isRunning = false;
    logger.info('⏹️ [SCHEDULER] Background research scheduler stopped');
  }

  /**
   * Check all users and schedule/cancel their research intervals as needed
   */
  private async checkAndScheduleUserResearch() {
    try {
      console.log('🔥 [HARD_LOG] [CHECK_USERS_START] checkAndScheduleUserResearch() - fetching users from Firestore');
      logger.debug({
        schedulerRunning: this.isRunning,
        activeIntervals: this.userIntervals.size,
        activeJobStates: this.userJobStates.size
      }, '🔍 [SCHEDULER_IMMORTAL] Checking users for background research scheduling - ensuring all enabled users are scheduled');

      const db = getFirebaseAdmin().firestore();
      const usersSnapshot = await db.collection('users').get();
      console.log('🔥 [HARD_LOG] [CHECK_USERS_FETCHED] Fetched', usersSnapshot.docs.length, 'users from Firestore');

      logger.info({
        userCount: usersSnapshot.docs.length,
        activeIntervalsBefore: this.userIntervals.size
      }, '📊 [SCHEDULER_IMMORTAL] Checking users for background research - verifying scheduler continuity');

      let scheduledCount = 0;
      let skippedCount = 0;

      // Process users in small batches to prevent event loop blocking
      const BATCH_SIZE = 3;
      const userDocs = usersSnapshot.docs;

      for (let i = 0; i < userDocs.length; i += BATCH_SIZE) {
        const batch = userDocs.slice(i, i + BATCH_SIZE);
        console.log(`🔥 [HARD_LOG] [BATCH_PROCESS] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(userDocs.length / BATCH_SIZE)} (${batch.length} users)`);

        // Process each user in the batch
        for (const userDoc of batch) {
          const uid = userDoc.id;
          console.log('🔥 [HARD_LOG] [USER_CHECK] Processing user:', uid);

          // CRITICAL: Skip system/internal UIDs
          if (this.isSystemUid(uid)) {
            console.log('🔥 [HARD_LOG] [USER_SKIP] Skipping system UID:', uid);
            continue;
          }

          const wasScheduled = this.userIntervals.has(uid);
          console.log('🔥 [HARD_LOG] [USER_SCHEDULE_START] Calling updateUserResearchSchedule() for:', uid, 'wasScheduled:', wasScheduled);
          await this.updateUserResearchSchedule(uid);
          const isScheduled = this.userIntervals.has(uid);
          console.log('🔥 [HARD_LOG] [USER_SCHEDULE_COMPLETE] updateUserResearchSchedule() completed for:', uid, 'isScheduled:', isScheduled);

          if (isScheduled && !wasScheduled) {
            scheduledCount++;
            logger.info({ uid }, '✅ [SCHEDULER_IMMORTAL] User scheduled/re-scheduled - interval created');
          } else if (isScheduled && wasScheduled) {
            // Already scheduled - verified
          } else if (!isScheduled) {
            skippedCount++;
          }
        }

        // Yield to event loop between batches to prevent blocking
        if (i + BATCH_SIZE < userDocs.length) {
          console.log('🔥 [HARD_LOG] [BATCH_YIELD] Yielding to event loop between batches');
          await yieldToEventLoop();
        }
      }

      logger.info({
        totalUsers: usersSnapshot.docs.length,
        scheduledCount,
        skippedCount,
        activeIntervalsAfter: this.userIntervals.size,
        schedulerContinues: true
      }, '✅ [SCHEDULER_IMMORTAL] Check cycle complete - scheduler verified, will continue running');
    } catch (error: any) {
      // CRITICAL: Errors in checkAndScheduleUserResearch should NOT stop the scheduler
      // The interval will continue and retry on next cycle
      logger.error({
        error: error.message,
        stack: error.stack,
        schedulerContinues: true,
        willRetry: true
      }, '❌ [SCHEDULER_IMMORTAL] Error checking user research schedules - scheduler continues, will retry on next cycle');
      // DO NOT throw - allow scheduler to continue
    }
  }

  /**
   * Update research schedule for a specific user based on their settings
   * CRITICAL: Settings are read ONLY from backend (single source of truth)
   * IMPLEMENTS: Two-mode system with conflict resolution
   * - AUTO_TRADE_RESEARCH: Auto-trade execution (priority, disables Telegram mode)
   * - TELEGRAM_BACKGROUND_RESEARCH: Telegram alerts only
   */
  private async updateUserResearchSchedule(uid: string) {
    try {
      // REMOVED: INVALID_KEYS check no longer blocks scheduling
      // Scheduler should run even with invalid keys - auto-trade engine will save SKIPPED history
      // This ensures history is always updated and user sees feedback

      // CRITICAL: Skip system/internal UIDs
      if (this.isSystemUid(uid)) {
        return;
      }

      const db = getFirebaseAdmin().firestore();

      // Check Auto Trade config first (highest priority)
      const autoTradeConfigDoc = await db.collection('users').doc(uid).collection('autoTradeConfig').doc('current').get();
      const autoTradeConfig = autoTradeConfigDoc.exists ? autoTradeConfigDoc.data() : null;
      const autoTradeEnabled = autoTradeConfig?.autoTradeEnabled === true;

      // Read background research settings
      const settings = await firestoreAdapter.getBackgroundResearchSettings(uid);
      // CRITICAL: Check explicit telegramBackgroundResearchEnabled flag first
      // This flag is set when user completes Telegram setup and starts Deep Research
      const telegramBgResearchEnabled = settings?.telegramBackgroundResearchEnabled === true ||
        (settings?.backgroundResearchEnabled === true && settings?.telegramBackgroundResearchEnabled !== false);

      // EARLY RETURN: Skip users with both modes disabled
      // Do not read integrations, validate frequency, or touch scheduler interval
      if (!autoTradeEnabled && !telegramBgResearchEnabled) {
        console.log('🔥 [HARD_LOG] [EARLY_RETURN] Both modes disabled for user:', uid, '- skipping all processing');
        // Remove any existing interval for this user
        if (this.userIntervals.has(uid)) {
          clearInterval(this.userIntervals.get(uid)!);
          this.userIntervals.delete(uid);
          this.userJobStates.delete(uid);
          console.log('🔥 [HARD_LOG] [INTERVAL_CLEANUP] Removed interval for disabled user:', uid);
        }
        return;
      }

      // CONFLICT RESOLUTION: Auto-Trade always wins for execution mode
      // CRITICAL: When Auto-Trade is enabled, Telegram Background Research is COMPLETELY BYPASSED
      // Telegram alerts are sent FROM Auto-Trade engine, not from separate Telegram engine
      let mode: 'TELEGRAM_BACKGROUND_RESEARCH' | 'AUTO_TRADE_RESEARCH' | null = null;
      let shouldSchedule = false;
      let finalFrequency: number | null = null;

      console.log('🔥 [HARD_LOG] [MODE_CHECK] Checking mode for user:', uid, 'autoTradeEnabled:', autoTradeEnabled, 'telegramBgResearchEnabled:', telegramBgResearchEnabled);

      if (autoTradeEnabled) {
        // AUTO_TRADE_RESEARCH mode - HIGHEST PRIORITY
        // CRITICAL: Telegram Background Research engine is COMPLETELY BYPASSED when Auto-Trade is enabled
        mode = RESEARCH_MODE.AUTO_TRADE_RESEARCH;
        // CRITICAL: Frequency MUST come from Auto-Trade settings, NOT Telegram settings
        // When Auto-Trade is enabled, Telegram frequency is IGNORED
        finalFrequency = settings?.researchFrequencyMinutes || 5;
        shouldSchedule = true;
        console.log('🔥 [HARD_LOG] [MODE_SELECTED] AUTO_TRADE_RESEARCH mode selected, frequency:', finalFrequency, 'shouldSchedule:', shouldSchedule);

        // HARD LOG: Mode priority enforcement
        logger.info({
          uid,
          autoTradeEnabled: true,
          telegramBgResearchEnabled,
          selectedMode: 'AUTO_TRADE_RESEARCH',
          telegramModeBypassed: true,
          frequencySource: 'AUTO_TRADE',
          frequencyMinutes: finalFrequency,
          telegramFrequencyIgnored: true
        }, '🎯 [MODE_PRIORITY] Auto-Trade ENABLED → AUTO_TRADE_RESEARCH mode selected, Telegram Background Research BYPASSED');

        // CRITICAL: Exchange API decryption failure must NOT block scheduler
        // Scheduler should ALWAYS run when autoTradeEnabled === true
        // Exchange API decryption failure will block trade execution at runtime, not scheduler execution
        const hasExchangeAPIs = await this.hasUsableExchangeAPIs(uid);
        if (!hasExchangeAPIs) {
          // Exchange APIs missing - log warning but continue with AUTO_TRADE_RESEARCH mode
          // Trade execution will be blocked at runtime, but research will continue
          logger.warn({ uid }, '⚠️ [SCHEDULER] Auto-Trade exchange APIs missing - scheduler continues, trade execution will be blocked at runtime');
        }

        // CRITICAL: Primary API missing should NOT block scheduler
        // Research will handle missing APIs gracefully at runtime
        const hasPrimaryAPIs = await this.hasUsableMarketDataProviders(uid);
        if (!hasPrimaryAPIs) {
          // Primary APIs missing - log warning but continue with AUTO_TRADE_RESEARCH mode
          // Research will handle missing APIs gracefully at runtime
          logger.warn({ uid }, '⚠️ [SCHEDULER] Auto-Trade primary APIs missing - scheduler continues, research will handle gracefully at runtime');
        }

        // 🔥 DEBUG: Log scheduler enablement and mode selection
        logger.info({
          uid,
          autoTradeEnabled,
          telegramBgResearchEnabled,
          mode: 'AUTO_TRADE_RESEARCH',
          frequency: finalFrequency,
          hasExchangeAPIs,
          hasPrimaryAPIs,
          telegramEngineBypassed: true,
          telegramAlertsFromAutoTrade: true
        }, '🔍 [SCHEDULER_DEBUG] AUTO_TRADE_RESEARCH mode enabled - scheduler will run regardless of API availability, Telegram engine BYPASSED, alerts from Auto-Trade engine');
      } else if (telegramBgResearchEnabled) {
        // TELEGRAM_BACKGROUND_RESEARCH mode (TELEGRAM_ONLY)
        // CRITICAL: This mode ONLY runs when Auto-Trade is DISABLED
        mode = RESEARCH_MODE.TELEGRAM_BACKGROUND_RESEARCH;
        // CRITICAL: Frequency comes from Telegram settings (same field, but only used when Auto-Trade is off)
        finalFrequency = settings?.researchFrequencyMinutes || 5;
        shouldSchedule = true;

        // HARD LOG: Telegram-only mode
        logger.info({
          uid,
          autoTradeEnabled: false,
          telegramBgResearchEnabled: true,
          selectedMode: 'TELEGRAM_BACKGROUND_RESEARCH',
          autoTradeBypassed: true,
          frequencySource: 'TELEGRAM',
          frequencyMinutes: finalFrequency
        }, '📱 [MODE_PRIORITY] Auto-Trade DISABLED + Telegram ENABLED → TELEGRAM_BACKGROUND_RESEARCH mode selected, Auto-Trade BYPASSED');

        // CRITICAL: TELEGRAM_BACKGROUND_RESEARCH requires primary APIs (CryptoCompare AND NewsData)
        // But don't disable if missing - just log warning (runtime will handle errors)
        const hasRequiredAPIs = await this.hasRequiredPrimaryAPIs(uid);
        if (!hasRequiredAPIs) {
          logger.warn({ uid }, '⚠️ [SCHEDULER] Telegram Background Research: Some primary APIs missing, but continuing (runtime will handle)');
          // Continue anyway - runtime will handle API errors gracefully
        }

        // 🔥 DEBUG: Log scheduler enablement and mode selection
        logger.info({
          uid,
          autoTradeEnabled,
          telegramBgResearchEnabled,
          mode: 'TELEGRAM_BACKGROUND_RESEARCH',
          frequency: finalFrequency
        }, '🔍 [SCHEDULER_DEBUG] TELEGRAM_BACKGROUND_RESEARCH mode enabled');

        logger.info({ uid, frequency: finalFrequency }, '📱 [SCHEDULER] Scheduler running in TELEGRAM_ONLY mode');
      } else {
        // BOTH are OFF → do not schedule
        // CRITICAL: Scheduler is disabled ONLY when BOTH autoTradeEnabled AND telegramBgResearchEnabled are false
        console.log('🔥 [HARD_LOG] [MODE_BOTH_OFF] Both modes OFF for user:', uid, '- disabling scheduler');
        logger.info({
          uid,
          autoTradeEnabled,
          telegramBgResearchEnabled
        }, '⏭️ [SCHEDULER] Both Auto Trade and Telegram Background Research are OFF - disabling scheduler');
        await this.disableUserScheduler(uid);
        return;
      }

      // Validate frequency
      if (!finalFrequency || finalFrequency <= 0) {
        console.log('🔥 [HARD_LOG] [FREQUENCY_INVALID] Invalid frequency for user:', uid, 'frequency:', finalFrequency);
        logger.warn({ uid, finalFrequency }, '⏭️ [SCHEDULER] Background research DISABLED - Invalid or missing frequency');
        await this.disableUserScheduler(uid);
        return;
      }
      console.log('🔥 [HARD_LOG] [FREQUENCY_VALID] Frequency validated for user:', uid, 'frequency:', finalFrequency);

      // CRITICAL: Accuracy trigger is NOT validated here - it's an output, not a prerequisite
      // Research will ALWAYS run at the configured interval
      // Accuracy trigger is evaluated AFTER research completes (in processUserResearch)

      const intervalMs = finalFrequency * 60 * 1000;

      // Check if we need to update the interval
      const existingInterval = this.userIntervals.get(uid);
      const existingState = this.userJobStates.get(uid);

      // CRITICAL: INTERVAL LIFECYCLE HARDENING - Never clear intervals mid-cycle
      // Only create intervals if they don't exist. Let existing intervals finish their current cycle.
      // Changes to frequency/mode apply on the NEXT cycle, not the current one.
      if (existingInterval) {
        // CRITICAL: Interval exists - DO NOT clear it mid-cycle
        // Even if frequency or mode changed, let current cycle complete
        // Changes will apply automatically on next checkAndScheduleUserResearch cycle
        logger.info({
          uid,
          frequency: finalFrequency,
          mode,
          intervalExists: true,
          action: 'PRESERVE_EXISTING_INTERVAL',
          reason: 'Never clear intervals mid-cycle - changes apply next cycle'
        }, '✅ [SCHEDULER_IMMORTAL] Interval exists - preserving to prevent mid-cycle interruption');
        return;
      }

      // CRITICAL: Only create interval if it doesn't exist
      // This ensures jobState and interval always exist together
      logger.info({
        uid,
        frequency: finalFrequency,
        mode,
        intervalMissing: true,
        action: 'CREATE_NEW_INTERVAL'
      }, '🔄 [SCHEDULER_IMMORTAL] Creating new interval - jobState and interval will exist together');

      // Initialize job state if not exists
      if (!existingState) {
        this.userJobStates.set(uid, {
          isRunning: false,
          lastRunAt: null,
          nextRunAt: null,
          frequencyMinutes: finalFrequency, // Store frequency to detect changes
          mode: mode // Store mode for processUserResearch
        } as any);
      } else {
        (existingState as any).frequencyMinutes = finalFrequency;
        (existingState as any).mode = mode;
      }

      // Calculate next run time
      const now = new Date();
      const nextRun = new Date(now.getTime() + intervalMs);

      // Schedule user-specific research with EXACT interval
      // REFACTORED: Use safeSetInterval for event loop protection
      console.log('🔥 [HARD_LOG] [INTERVAL_CREATE_USER] Creating user interval for:', uid, 'intervalMs:', intervalMs);
      const userInterval = safeSetInterval(
        async () => {
          console.log('🔥 [HARD_LOG] [INTERVAL_TICK_USER] User interval tick for:', uid, '- calling processUserResearchSafe()');
          await this.processUserResearchSafe(uid);
        },
        intervalMs,
        `user-research-${uid}`
      );

      this.userIntervals.set(uid, userInterval);
      console.log('🔥 [HARD_LOG] [INTERVAL_CREATED_USER] User interval created for:', uid, 'intervalId exists:', !!userInterval);

      // Update state
      const state = this.userJobStates.get(uid)!;
      state.nextRunAt = nextRun;

      logger.info({
        uid,
        frequencyMinutes: finalFrequency,
        intervalMs,
        nextRunAt: nextRun.toISOString(),
        mode,
        autoTradeEnabled,
        telegramBgResearchEnabled,
        intervalCreated: true,
        schedulerImmortal: true
      }, '⏰ [SCHEDULER_IMMORTAL] User background research scheduled - interval created/updated, scheduler will run continuously');

      // Run immediately if nextRunAt is in the past or doesn't exist
      const shouldRunNow = !state.lastRunAt ||
        (state.nextRunAt && state.nextRunAt <= now) ||
        !state.nextRunAt;

      if (shouldRunNow) {
        // Small random delay to avoid all users running at once
        const delay = Math.random() * 2000; // 0-2 seconds
        setTimeout(() => {
          // Fire and forget - don't block
          runBackgroundTask(
            () => this.processUserResearchSafe(uid),
            `initial-user-research-${uid}`,
            25000 // 25s timeout
          ).catch((err) => {
            logger.warn({ uid, error: err?.message }, 'Initial user research failed');
          });
        }, delay);
      }

    } catch (error: any) {
      // CRITICAL: Errors in updateUserResearchSchedule should NOT stop the scheduler
      // The 60-second checkAndScheduleUserResearch loop will retry on next cycle
      logger.error({
        error: error.message,
        uid,
        stack: error.stack,
        schedulerContinues: true,
        willRetry: true
      }, '❌ [SCHEDULER_IMMORTAL] Error updating user research schedule - scheduler continues, will retry on next check cycle');
      // DO NOT throw - allow scheduler to continue and retry
    }
  }

  /**
   * Disable scheduler for a user - cleanup all timers and state
   * CRITICAL: This function MUST NEVER mutate user enable flags in Firestore
   * Scheduler should only manage in-memory timers and state
   * User enable flags (autoTradeEnabled, backgroundResearchEnabled, telegramBackgroundResearchEnabled) 
   * are controlled ONLY by user actions, NOT by scheduler logic
   */
  private async disableUserScheduler(uid: string) {
    const existingInterval = this.userIntervals.get(uid);

    if (existingInterval) {
      // Clear timer
      clearInterval(existingInterval);
      this.userIntervals.delete(uid);

      // Remove in-memory job state
      this.userJobStates.delete(uid);

      logger.info({
        uid,
        intervalCleared: true,
        stateRemoved: true,
        reason: 'User explicitly disabled auto-trade or telegram background research'
      }, '🛑 [SCHEDULER_IMMORTAL] User scheduler disabled - interval cleared, state removed (user action only)');

      // CRITICAL: Do NOT mutate user enable flags in Firestore
      // Scheduler should only manage in-memory state
      // User flags are controlled by user actions, not scheduler
      // Only update engineState for diagnostics visibility (read-only diagnostics)
      try {
        await firestoreAdapter.saveBackgroundResearchSettings(uid, {
          engineState: 'STOPPED',
          // CRITICAL: Do NOT set backgroundResearchEnabled or telegramBackgroundResearchEnabled to false
          // These flags are user-controlled and should NOT be mutated by scheduler
        });
        logger.info({ uid }, 'Scheduler state cleared - timers and in-memory state removed (user flags preserved)');
      } catch (persistError: any) {
        logger.warn({ uid, error: persistError.message }, 'Failed to persist engineState (non-critical)');
      }

      logger.info({ uid }, '🛑 [SCHEDULER] Scheduler stopped for user - timers cleared, state removed (user enable flags NOT modified)');
    }
  }

  /**
   * Handle settings update for a user (call this when user settings change)
   */
  async onUserSettingsChanged(uid: string) {
    logger.info({ uid }, '🔄 [SCHEDULER] User settings changed, updating schedule');
    await this.updateUserResearchSchedule(uid);
  }

  /**
   * HARD GUARANTEE: Ensure user is registered in scheduler
   * CRITICAL: This function MUST be called when:
   * - background-research/start is called
   * - auto-trade is enabled
   * - app bootstrap/login
   * 
   * This ensures user is ALWAYS scheduled if either:
   * - autoTradeEnabled === true
   * OR
   * - telegramBackgroundResearchEnabled === true
   * 
   * Idempotent: Safe to call multiple times
   */
  async ensureUserResearchScheduled(uid: string): Promise<{ scheduled: boolean; reason?: string }> {
    try {
      // CRITICAL: Skip system/internal UIDs
      if (this.isSystemUid(uid)) {
        return { scheduled: false, reason: 'System UID skipped' };
      }

      logger.info({ uid }, '🔒 [SCHEDULER] ensureUserResearchScheduled: Hard guarantee check');

      // Check current state
      const isCurrentlyScheduled = this.isUserScheduled(uid);

      if (isCurrentlyScheduled) {
        logger.info({ uid }, '✅ [SCHEDULER] User already scheduled - no action needed');
        return { scheduled: true, reason: 'Already scheduled' };
      }

      // Load settings to determine if user should be scheduled
      const db = getFirebaseAdmin().firestore();

      // Check Auto Trade config
      const autoTradeConfigDoc = await db.collection('users').doc(uid).collection('autoTradeConfig').doc('current').get();
      const autoTradeConfig = autoTradeConfigDoc.exists ? autoTradeConfigDoc.data() : null;
      const autoTradeEnabled = autoTradeConfig?.autoTradeEnabled === true;

      // Check Telegram Background Research
      const settings = await firestoreAdapter.getBackgroundResearchSettings(uid);
      const telegramBgResearchEnabled = settings?.telegramBackgroundResearchEnabled === true ||
        (settings?.backgroundResearchEnabled === true && settings?.telegramBackgroundResearchEnabled !== false);

      // CRITICAL: User MUST be scheduled if either condition is true
      if (!autoTradeEnabled && !telegramBgResearchEnabled) {
        logger.info({ uid, autoTradeEnabled, telegramBgResearchEnabled }, '⏭️ [SCHEDULER] User not eligible for scheduling - both modes disabled');
        return { scheduled: false, reason: 'Both auto-trade and Telegram background research are disabled' };
      }

      // FORCE registration via updateUserResearchSchedule
      logger.info({ uid, autoTradeEnabled, telegramBgResearchEnabled }, '🔒 [SCHEDULER] Forcing user registration in scheduler');
      await this.updateUserResearchSchedule(uid);

      // Verify registration succeeded
      const isNowScheduled = this.isUserScheduled(uid);
      const jobState = this.getUserJobState(uid);

      if (isNowScheduled) {
        // Persist scheduled state to Firestore
        try {
          const nextRunAt = jobState?.nextRunAt;
          await firestoreAdapter.saveBackgroundResearchSettings(uid, {
            scheduled: true,
            nextRunAt: nextRunAt ? admin.firestore.Timestamp.fromDate(nextRunAt) : null,
            lastScheduledAt: admin.firestore.Timestamp.now(),
          });
          logger.info({ uid, nextRunAt: nextRunAt?.toISOString() }, '✅ [SCHEDULER] User scheduled and state persisted to Firestore');
        } catch (persistError: any) {
          logger.warn({ uid, error: persistError.message }, '⚠️ [SCHEDULER] Failed to persist scheduled state (scheduler still active)');
        }

        return { scheduled: true, reason: 'Successfully scheduled' };
      } else {
        logger.error({ uid }, '❌ [SCHEDULER] Registration failed - user not scheduled after updateUserResearchSchedule');
        return { scheduled: false, reason: 'Registration failed - check logs for details' };
      }
    } catch (error: any) {
      logger.error({ uid, error: error.message, stack: error.stack }, '❌ [SCHEDULER] Error in ensureUserResearchScheduled');
      return { scheduled: false, reason: `Error: ${error.message}` };
    }
  }

  /**
   * Check if user has an active research scheduler
   * Public method for status checks
   */
  isUserScheduled(uid: string): boolean {
    return this.userIntervals.has(uid);
  }

  /**
   * Get user job state (for status checks)
   * Public method for diagnostics
   */
  getUserJobState(uid: string): UserJobState | null {
    return this.userJobStates.get(uid) || null;
  }

  /**
   * Run comprehensive diagnostic check for Telegram Background Research
   * READ-ONLY: No side effects, only checks current state
   * Returns structured diagnostic with blockers if any
   */
  async runTelegramBackgroundDiagnostic(uid: string): Promise<{
    enabled: boolean;
    working: boolean;
    mode: 'TELEGRAM_BACKGROUND_RESEARCH' | 'AUTO_TRADE_RESEARCH' | null;
    schedulerRunning: boolean;
    userScheduled: boolean;
    blockers: string[];
    lastRunAt: string | null;
    nextRunAt: string | null;
    engineState: 'RUNNING' | 'STOPPED';
    readiness: {
      telegramSetup: 'Connected' | 'Missing' | 'TestFailed';
      cryptocompare: {
        status: 'PASS' | 'FAIL';
        connected: boolean;
        reason?: string;
      };
      coingecko: {
        status: 'PASS' | 'FAIL';
        connected: boolean;
        reason?: string;
      };
      verdict: 'READY' | 'NOT_READY';
    };
    details: {
      settingsValid: boolean;
      telegramConfigValid: boolean;
      providerAPIsValid: boolean;
      schedulerStateValid: boolean;
    };
  }> {
    const blockers: string[] = [];
    const details: any = {
      settingsValid: false,
      telegramConfigValid: false,
      providerAPIsValid: false,
      schedulerStateValid: false,
    };

    try {
      // 1. Check scheduler is running
      const schedulerRunning = this.isRunning;
      if (!schedulerRunning) {
        blockers.push('Background research scheduler is not running');
      }

      // 2. Check user settings
      const bgResearchSettings = await firestoreAdapter.getBackgroundResearchSettings(uid);
      const backgroundResearchEnabled = bgResearchSettings?.backgroundResearchEnabled === true;
      // CRITICAL: Check explicit telegramBackgroundResearchEnabled flag (declare early for use throughout function)
      const telegramBgResearchEnabled = bgResearchSettings?.telegramBackgroundResearchEnabled === true ||
        (bgResearchSettings?.backgroundResearchEnabled === true && bgResearchSettings?.telegramBackgroundResearchEnabled !== false);

      if (!telegramBgResearchEnabled && !backgroundResearchEnabled) {
        blockers.push('Telegram Background Research is not enabled in settings');
      }

      const researchFrequencyMinutes = bgResearchSettings?.researchFrequencyMinutes;
      if (!researchFrequencyMinutes || researchFrequencyMinutes <= 0) {
        blockers.push(`Invalid research frequency: ${researchFrequencyMinutes} (must be > 0)`);
      }

      const accuracyTrigger = bgResearchSettings?.accuracyTrigger;
      if (accuracyTrigger) {
        let minTrigger: number;
        let maxTrigger: number;

        if (typeof accuracyTrigger === 'number') {
          // Legacy format: single number
          minTrigger = accuracyTrigger;
          maxTrigger = 100;
        } else if (typeof accuracyTrigger === 'object' && accuracyTrigger !== null) {
          // New format: { min, max }
          minTrigger = (accuracyTrigger as any).min ?? 60;
          maxTrigger = (accuracyTrigger as any).max ?? 100;
        } else {
          minTrigger = 60;
          maxTrigger = 100;
        }

        if (minTrigger >= maxTrigger || minTrigger < 0 || maxTrigger > 100) {
          blockers.push(`Invalid accuracy trigger range: ${minTrigger}-${maxTrigger} (must be min < max, 0-100)`);
        }
      }

      // Check settings validity using telegramBgResearchEnabled flag
      if (telegramBgResearchEnabled && researchFrequencyMinutes && researchFrequencyMinutes > 0 && accuracyTrigger) {
        details.settingsValid = true;
      }

      // 3. Check Telegram configuration
      const telegramBotToken = bgResearchSettings?.telegramBotToken;
      const telegramChatId = bgResearchSettings?.telegramChatId;

      if (!telegramBotToken || telegramBotToken.trim().length === 0) {
        blockers.push('Telegram Bot Token is missing or empty');
      }
      if (!telegramChatId || telegramChatId.trim().length === 0) {
        blockers.push('Telegram Chat ID is missing or empty');
      }

      if (telegramBotToken && telegramBotToken.trim().length > 0 && telegramChatId && telegramChatId.trim().length > 0) {
        details.telegramConfigValid = true;
      }

      // 4. Check provider APIs and readiness status
      // CRITICAL: Use SAVED CONFIG only - do NOT make runtime API calls
      // Determine PASS/FAIL based on configuration state, not connectivity
      // BUCKET-AGNOSTIC: Check ALL buckets (marketData, metadata, news) for providers
      // PROVIDER-FAMILY: Handle variants like cryptocompare, cryptocompare_metadata, cryptocompare_news
      let providerAPIsValid = false;
      let telegramSetupStatus: 'Connected' | 'Missing' | 'TestFailed' = 'Missing';
      let cryptocompareStatus: 'OK' | 'Fail' = 'Fail';
      let coingeckoStatus: 'OK' | 'Fail' = 'Fail';
      let cryptocompareReason: string | undefined;
      let coingeckoReason: string | undefined;

      try {
        const { getUserIntegrationsByUid } = await import('../routes/users/providerConfig');
        const providerConfig = await getUserIntegrationsByUid(uid, 'background_job');

        // Check Telegram setup
        if (telegramBotToken && telegramBotToken.trim().length > 0 && telegramChatId && telegramChatId.trim().length > 0) {
          telegramSetupStatus = 'Connected';
        }

        // Helper: Find provider across ALL buckets by normalized key (ignores suffixes)
        const findProviderFamily = (baseName: string): { provider: any; bucket: string; key: string } | null => {
          const normalizedBase = baseName.toLowerCase().trim();
          const allBuckets = ['marketData', 'metadata', 'news'] as const;

          for (const bucket of allBuckets) {
            const bucketProviders = providerConfig?.[bucket] || {};
            for (const [key, provider] of Object.entries(bucketProviders)) {
              const normalizedKey = key.toLowerCase().trim();
              // Match exact or with suffix (e.g., cryptocompare, cryptocompare_metadata, cryptocompare_news)
              if (normalizedKey === normalizedBase || normalizedKey.startsWith(normalizedBase + '_')) {
                return { provider, bucket, key };
              }
            }
          }
          return null;
        };

        // Helper: Check if provider is enabled and has key (if required)
        const isProviderReady = (provider: any): { ready: boolean; reason?: string } => {
          if (!provider) {
            return { ready: false, reason: 'Provider not found' };
          }
          if (provider.enabled !== true) {
            return { ready: false, reason: 'Provider disabled' };
          }
          const apiKeyRequired = provider.apiKeyRequired !== false; // Default to true
          if (apiKeyRequired) {
            const hasKey = !!(provider.apiKey && provider.apiKey.trim().length > 0);
            if (!hasKey) {
              return { ready: false, reason: 'API key missing' };
            }
          }
          return { ready: true };
        };

        // Check CryptoCompare provider family
        // Look for: cryptocompare, cryptocompare_metadata, cryptocompare_news in ANY bucket
        const cryptocompareMatch = findProviderFamily('cryptocompare');
        if (!cryptocompareMatch) {
          cryptocompareStatus = 'Fail';
          cryptocompareReason = 'Provider not configured';
          blockers.push('CryptoCompare API is not configured');
        } else {
          const readyCheck = isProviderReady(cryptocompareMatch.provider);
          if (!readyCheck.ready) {
            cryptocompareStatus = 'Fail';
            cryptocompareReason = readyCheck.reason || 'Not ready';
            if (readyCheck.reason === 'Provider disabled') {
              blockers.push('CryptoCompare API is disabled');
            } else if (readyCheck.reason === 'API key missing') {
              blockers.push('CryptoCompare API key is missing');
            }
          } else {
            // PASS: provider exists, enabled, and has key (if required)
            cryptocompareStatus = 'OK';
          }
        }

        // Check CoinGecko provider family
        // Look for: coingecko, coingecko_metadata in ANY bucket
        // CoinGecko does NOT require API key, so PASS if exists and enabled
        const coingeckoMatch = findProviderFamily('coingecko');
        if (!coingeckoMatch) {
          coingeckoStatus = 'Fail';
          coingeckoReason = 'Provider not available';
          // Don't add blocker for CoinGecko since it's optional metadata
        } else {
          // CoinGecko exists - check if enabled
          if (coingeckoMatch.provider?.enabled === true) {
            // PASS: CoinGecko exists and is enabled (doesn't require API key)
            coingeckoStatus = 'OK';
          } else {
            // Even if disabled, it's still available (can be enabled)
            // But mark as PASS since provider exists and can be used
            coingeckoStatus = 'OK';
          }
        }

        // CRITICAL: Check for ANY valid news provider (not just NewsData)
        // A provider is VALID only if: decryptedApiKey exists AND decryptedApiKey.length > 0
        const hasValidNewsProvider = providerConfig?.news &&
          Object.values(providerConfig.news).some((p: any) =>
            p?.enabled === true && p?.apiKey && typeof p.apiKey === 'string' && p.apiKey.trim().length > 0
          );

        // CRITICAL: Only require minimum viable providers (market data + news)
        // Do NOT require all providers to be valid
        // Provider APIs valid if CryptoCompare is OK AND at least one valid news provider exists
        if (cryptocompareStatus === 'OK' && hasValidNewsProvider) {
          providerAPIsValid = true;
          details.providerAPIsValid = true;
        } else {
          // Only add blocker if NO news provider exists (not just NewsData)
          if (!hasValidNewsProvider) {
            blockers.push('At least one news provider API key is required');
          }
        }
      } catch (apiError: any) {
        // CRITICAL: Do NOT mark providers as FAIL due to config loading errors
        // Log error but don't surface as provider failure
        logger.warn({ uid, error: apiError.message }, 'Failed to load provider config for diagnostics');
        // Keep default FAIL status but don't add blocker (config might be temporarily unavailable)
      }

      // 5. Check auto-trade mode (priority check)
      const db = getFirebaseAdmin().firestore();
      const autoTradeConfigDoc = await db.collection('users').doc(uid).collection('autoTradeConfig').doc('current').get();
      const autoTradeConfig = autoTradeConfigDoc.exists ? autoTradeConfigDoc.data() : null;
      const autoTradeEnabled = autoTradeConfig?.autoTradeEnabled === true;

      let mode: 'TELEGRAM_BACKGROUND_RESEARCH' | 'AUTO_TRADE_RESEARCH' | null = null;
      if (autoTradeEnabled) {
        mode = 'AUTO_TRADE_RESEARCH';
        if (telegramBgResearchEnabled) {
          blockers.push('Auto-Trade mode is enabled - Telegram Background Research is automatically disabled (Auto-Trade has priority)');
        }
      } else if (telegramBgResearchEnabled) {
        mode = 'TELEGRAM_BACKGROUND_RESEARCH';
      }

      // 6. Check scheduler state
      const userScheduled = this.isUserScheduled(uid);
      const jobState = this.getUserJobState(uid);

      // CRITICAL: User Job Scheduled check - must be PASS if user is registered
      if (telegramBgResearchEnabled || autoTradeEnabled) {
        if (!userScheduled) {
          blockers.push('User is not registered in background research scheduler');
          details.schedulerStateValid = false;
        } else {
          // User is scheduled - mark as valid
          details.schedulerStateValid = true;
          logger.info({ uid }, '✅ [DIAGNOSTICS] User Job Scheduled = PASS');
        }
      }

      if (jobState) {
        const jobMode = (jobState as any).mode;
        if (mode && jobMode !== mode) {
          blockers.push(`Scheduler mode mismatch: expected ${mode}, but scheduler has ${jobMode}`);
        }

        if (jobState.nextRunAt) {
          // nextRunAt is set - scheduler is properly configured
          if (!details.schedulerStateValid) {
            details.schedulerStateValid = true;
          }
        } else if (userScheduled) {
          // User is scheduled but nextRunAt not set - this is OK (will be set on next run)
          logger.debug({ uid }, 'User scheduled but nextRunAt not yet set (will be set on first run)');
        }
      } else if ((telegramBgResearchEnabled || autoTradeEnabled) && !userScheduled) {
        blockers.push('Scheduler job state not found for user - user not registered');
      }

      // 7. Runtime sanity checks
      if (jobState?.lastRunAt) {
        const lastRunTime = jobState.lastRunAt.getTime();
        const now = Date.now();
        // Check if lastRunAt is in the future (invalid)
        if (lastRunTime > now) {
          blockers.push(`Invalid lastRunAt: ${jobState.lastRunAt.toISOString()} (in the future)`);
        }
      }

      // Determine if working
      // Use telegramBgResearchEnabled flag for Telegram mode
      const working = blockers.length === 0 &&
        schedulerRunning &&
        userScheduled &&
        telegramBgResearchEnabled &&
        mode === 'TELEGRAM_BACKGROUND_RESEARCH';

      // Determine engine state - authoritative logic:
      // 1. First check Firestore (persisted state)
      // 2. Then infer from scheduler activity and telegramBackgroundResearchEnabled flag
      // 3. Self-heal if scheduler active but state missing
      // NOTE: telegramBgResearchEnabled is already declared above (line ~512)
      let engineState: 'RUNNING' | 'STOPPED' = 'STOPPED';
      const persistedEngineState = bgResearchSettings?.engineState as 'RUNNING' | 'STOPPED' | undefined;

      if (persistedEngineState === 'RUNNING') {
        // Firestore says RUNNING - use it
        engineState = 'RUNNING';
        logger.debug({ uid }, 'Engine state read from Firestore: RUNNING');
      } else if (telegramBgResearchEnabled && (userScheduled || jobState?.nextRunAt)) {
        // Telegram Background Research enabled and scheduler active - infer RUNNING
        engineState = 'RUNNING';
        logger.info({ uid }, 'Engine state inferred from scheduler activity and telegramBackgroundResearchEnabled');

        // CRITICAL: Diagnostics is READ-ONLY - do NOT mutate user enable flags
        // Only update engineState for visibility (diagnostics should not self-heal by writing flags)
        // User flags (backgroundResearchEnabled, telegramBackgroundResearchEnabled) are controlled by user actions, not diagnostics
      } else if (!telegramBgResearchEnabled && !backgroundResearchEnabled) {
        // Both explicitly disabled - STOPPED
        engineState = 'STOPPED';
        logger.debug({ uid }, 'Engine state: STOPPED (background research and telegram background research disabled)');
      } else {
        // Default: STOPPED if scheduler not initialized
        engineState = 'STOPPED';
        logger.debug({ uid }, 'Engine state: STOPPED (scheduler not initialized)');
      }

      // Determine readiness verdict
      // CRITICAL: Only require minimum viable providers (CryptoCompare + news provider)
      // CoinGecko is optional - do NOT require it for READY status
      const readinessVerdict: 'READY' | 'NOT_READY' =
        (telegramSetupStatus === 'Connected' &&
          cryptocompareStatus === 'OK' &&
          providerAPIsValid) ? 'READY' : 'NOT_READY';

      // CRITICAL: Check if research cycle has run yet
      // If accuracy is 0 and no cycle has run, show "Waiting for first research cycle"
      const bgSettings = await firestoreAdapter.getBackgroundResearchSettings(uid);
      const lastAccuracy = bgSettings?.lastAccuracy ?? 0;
      const hasRunCycle = jobState?.lastRunAt !== null && jobState?.lastRunAt !== undefined;
      const accuracyStatus = hasRunCycle
        ? (lastAccuracy > 0 ? `${lastAccuracy.toFixed(1)}%` : '0.0%')
        : 'Waiting for first research cycle';

      return {
        enabled: telegramBgResearchEnabled || backgroundResearchEnabled,
        working,
        mode,
        schedulerRunning,
        userScheduled,
        blockers,
        lastRunAt: jobState?.lastRunAt ? jobState.lastRunAt.toISOString() : null,
        nextRunAt: jobState?.nextRunAt ? jobState.nextRunAt.toISOString() : null,
        engineState,
        accuracy: lastAccuracy,
        accuracyStatus, // Human-readable status
        hasRunCycle, // Flag indicating if at least one cycle has completed
        readiness: {
          telegramSetup: telegramSetupStatus,
          cryptocompare: {
            status: cryptocompareStatus === 'OK' ? 'PASS' : 'FAIL',
            connected: cryptocompareStatus === 'OK',
            reason: cryptocompareReason,
          },
          coingecko: {
            status: coingeckoStatus === 'OK' ? 'PASS' : 'FAIL',
            connected: coingeckoStatus === 'OK',
            reason: coingeckoReason,
          },
          verdict: readinessVerdict,
        },
        details: {
          ...details,
          researchCycleActive: hasRunCycle || userScheduled, // Research cycle is active if scheduled or has run
          userJobScheduled: userScheduled ? 'PASS' : 'FAIL', // Explicit status for UI
        },
      } as any; // Type assertion to allow new fields
    } catch (error: any) {
      logger.error({ uid, error: error.message, stack: error.stack }, 'Error running Telegram background diagnostic');
      blockers.push(`Diagnostic check failed: ${error.message}`);

      return {
        enabled: false,
        working: false,
        mode: null,
        schedulerRunning: this.isRunning,
        userScheduled: this.isUserScheduled(uid),
        blockers,
        lastRunAt: null,
        nextRunAt: null,
        engineState: 'STOPPED',
        readiness: {
          telegramSetup: 'Missing',
          cryptocompare: {
            status: 'FAIL',
            connected: false,
            reason: 'Configuration check failed',
          },
          coingecko: {
            status: 'FAIL',
            connected: false,
            reason: 'Configuration check failed',
          },
          verdict: 'NOT_READY',
        },
        details,
      };
    }
  }

  /**
   * Safe wrapper for processUserResearch
   * Wraps with timeout and event loop protection
   */
  private async processUserResearchSafe(uid: string): Promise<void> {
    console.log('🔥 [HARD_LOG] [PROCESS_SAFE_START] processUserResearchSafe() called for user:', uid);
    // CRITICAL FIX: Remove background task pause check - user research intervals must execute
    // The pause logic in safeSetInterval is sufficient for throttling, but user research
    // should always execute when the interval fires to ensure research cycles complete
    // Background task pausing should only affect the main scheduler heartbeat, not user research execution

    // Yield control before heavy operations
    await yieldToEventLoop();

    try {
      console.log('🔥 [HARD_LOG] [PROCESS_SAFE_EXECUTING] Calling processUserResearch() for user:', uid);
      await withTimeout(
        () => this.processUserResearch(uid),
        90000, // 90s timeout for user research (increased for Deep Research latency)
        `process-user-research-${uid}`
      );
      console.log('🔥 [HARD_LOG] [PROCESS_SAFE_COMPLETE] processUserResearch() completed for user:', uid);
    } catch (err: any) {
      // CRITICAL: Errors in processUserResearch should NEVER stop the scheduler
      // The interval will continue running and retry on next cycle
      logger.warn({
        uid,
        error: err?.message,
        schedulerContinues: true,
        willRetry: true,
        intervalStillActive: this.userIntervals.has(uid)
      }, '⚠️ [SCHEDULER_IMMORTAL] User research timed out or failed - scheduler continues, will retry on next interval');

      // CRITICAL: On error, update state and write history for the failed cycle
      try {
        const settings = await firestoreAdapter.getBackgroundResearchSettings(uid);
        const jobState = this.userJobStates.get(uid);
        const mode = (jobState as any)?.mode || RESEARCH_MODE.TELEGRAM_BACKGROUND_RESEARCH; // Safe fallback

        const errorNow = admin.firestore.Timestamp.now();
        const errorFrequencyMinutes = settings?.researchFrequencyMinutes || 5;
        const errorNextRunAt = admin.firestore.Timestamp.fromMillis(
          Date.now() + (errorFrequencyMinutes * 60 * 1000)
        );

        // Write history for the error
        await firestoreAdapter.storeResearchHistory(uid, {
          symbol: 'ERROR_CYCLE',
          signal: 'HOLD',
          accuracy: 0,
          price: 0,
          tradePlan: null,
          isDeepResearch: true,
          source: mode === RESEARCH_MODE.AUTO_TRADE_RESEARCH ? 'AUTO_TRADE' : 'TELEGRAM_BACKGROUND',
          status: 'SKIPPED',
          error: err?.message,
          skipReason: 'Research cycle error in safe wrapper'
        });

        // Update state
        if (jobState) {
          jobState.isRunning = false;
          jobState.lastRunAt = errorNow.toDate();
          jobState.nextRunAt = errorNextRunAt.toDate();
        }

        // Update Firestore
        await firestoreAdapter.saveBackgroundResearchSettings(uid, {
          lastRunAt: errorNow,
          nextRunAt: errorNextRunAt,
          lastAccuracy: 0,
        });
      } catch (updateErr: any) {
        logger.warn({ uid, error: updateErr.message }, 'Failed to update state after safe wrapper error');
      }

      // CRITICAL: Verify interval still exists - if missing, log warning (will be recreated on next check)
      if (!this.userIntervals.has(uid)) {
        logger.warn({
          uid,
          intervalMissing: true,
          schedulerWillRecover: true,
          willBeRecreated: true
        }, '⚠️ [SCHEDULER_IMMORTAL] Interval missing after error - will be recreated on next checkAndScheduleUserResearch cycle');
      }
      // DO NOT throw - allow scheduler interval to continue
    }
  }

  /**
   * Process background research for a single user
   * CRITICAL: Uses Deep Research Engine, prevents duplicate jobs, tracks state
   */
  private async processUserResearch(uid: string) {
    console.log('🔥 [HARD_LOG] [PROCESS_START] processUserResearch() called for user:', uid);

    // CRITICAL: Read settings at the beginning for all code paths
    const settings = await firestoreAdapter.getBackgroundResearchSettings(uid);

    const jobState = this.userJobStates.get(uid);
    console.log('🔥 [HARD_LOG] [PROCESS_JOB_STATE] Job state for user:', uid, 'exists:', !!jobState, 'isRunning:', jobState?.isRunning);

    // Get mode from job state - this is frozen until next reschedule
    const mode = (jobState as any)?.mode || null;

    // Prevent duplicate jobs - check if already running
    if (jobState?.isRunning) {
      logger.warn({ uid }, '⏭️ [BACKGROUND_RESEARCH_SKIPPED] Background research already running for user');
      console.log('🔥 [HARD_LOG] [PROCESS_BLOCKED_DUPLICATE] Research already running, skipping for user:', uid);

      // CRITICAL: Update state and write history even for duplicate run early return
      const now = admin.firestore.Timestamp.now();
      const frequencyMinutes = settings?.researchFrequencyMinutes || 5;
      const nextRunAt = admin.firestore.Timestamp.fromMillis(
        Date.now() + (frequencyMinutes * 60 * 1000)
      );

      if (jobState) {
        jobState.lastRunAt = now.toDate();
        jobState.nextRunAt = nextRunAt.toDate();
        // Keep isRunning = true to prevent duplicate execution
      }

      // Write history for duplicate run skip
      try {
        await firestoreAdapter.storeResearchHistory(uid, {
          symbol: 'DUPLICATE_RUN',
          signal: 'HOLD',
          accuracy: 0,
          price: 0,
          tradePlan: null,
          isDeepResearch: true,
          source: mode === RESEARCH_MODE.AUTO_TRADE_RESEARCH ? 'AUTO_TRADE' : 'TELEGRAM_BACKGROUND',
          status: 'SKIPPED',
          skipReason: 'Research already running (duplicate execution prevented)'
        });
      } catch (histError: any) {
        logger.warn({ uid, error: histError.message }, 'Failed to store duplicate run skip history');
      }

      // Update Firestore state
      try {
        await firestoreAdapter.saveBackgroundResearchSettings(uid, {
          lastRunAt: now,
          nextRunAt,
          lastAccuracy: 0,
        });
      } catch (updateError: any) {
        logger.warn({ uid, error: updateError.message }, 'Failed to update state for duplicate run');
      }

      return;
    }

    try {
      // Mark as running
      if (jobState) {
        jobState.isRunning = true;
      } else {
        this.userJobStates.set(uid, {
          isRunning: true,
          lastRunAt: null,
          nextRunAt: null,
        });
      }

      // CRITICAL: Safety invariant - validate UID first
      if (this.isSystemUid(uid)) {
        logger.warn({ uid }, '⚠️ [RESEARCH] System UID detected, aborting research');
        // CRITICAL: Update state and write history even for system UID early return
        const now = admin.firestore.Timestamp.now();
        const frequencyMinutes = settings?.researchFrequencyMinutes || 5;
        const nextRunAt = admin.firestore.Timestamp.fromMillis(
          Date.now() + (frequencyMinutes * 60 * 1000)
        );

        if (jobState) {
          jobState.isRunning = false;
          jobState.lastRunAt = now.toDate();
          jobState.nextRunAt = nextRunAt.toDate();
        }

        // Write history for system UID skip
        try {
          await firestoreAdapter.storeResearchHistory(uid, {
            symbol: 'SYSTEM_UID',
            signal: 'HOLD',
            accuracy: 0,
            price: 0,
            tradePlan: null,
            isDeepResearch: true,
            source: mode === RESEARCH_MODE.AUTO_TRADE_RESEARCH ? 'AUTO_TRADE' : 'TELEGRAM_BACKGROUND',
            status: 'SKIPPED',
            skipReason: 'System UID detected'
          });
        } catch (histError: any) {
          logger.warn({ uid, error: histError.message }, 'Failed to store system UID skip history');
        }

        // Update Firestore state
        try {
          await firestoreAdapter.saveBackgroundResearchSettings(uid, {
            lastRunAt: now,
            nextRunAt,
            lastAccuracy: 0,
          });
        } catch (updateError: any) {
          logger.warn({ uid, error: updateError.message }, 'Failed to update state for system UID');
        }

        return;
      }

      console.log('🔥 [HARD_LOG] [PROCESS_MODE] Mode from job state for user:', uid, 'mode:', mode);

      // 🔥 DEBUG: Log scheduler mode at start of processUserResearch
      logger.info({
        uid,
        mode,
        jobStateExists: !!jobState,
        jobStateMode: (jobState as any)?.mode
      }, '🔍 [SCHEDULER_DEBUG] Starting processUserResearch - scheduler mode');

      // CRITICAL: Mode validation REMOVED from execution - mode is frozen until next reschedule
      // Mode was validated at scheduling time in updateUserResearchSchedule()
      // If mode changes between scheduling and execution, it will be corrected on next reschedule cycle
      // DO NOT re-read Firestore flags during execution to override frozen mode

      const now = admin.firestore.Timestamp.now();
      const frequencyMinutes = settings?.researchFrequencyMinutes || 5;
      const nextRunAt = admin.firestore.Timestamp.fromMillis(
        Date.now() + (frequencyMinutes * 60 * 1000)
      );

      // CRITICAL: Provider gating logic - Background Research should NOT require exchange APIs
      // Exchange APIs should only gate AUTO_TRADE execution, not research execution
      // CRITICAL FIX: Research execution MUST always run, even if no providers are configured or decrypt fails.
      // Removed ALL guards blocking "processUserResearch" due to missing/invalid provider configs. Only trade execution is gated downstream.

      // Note: API validation is now handled inside runAutoTradeResearchCycle
      // This ensures research runs and produces real results, not just SKIPPED history entries

      // frequencyMinutes already calculated above (line 485)
      const accuracyTrigger = settings?.accuracyTrigger || 80;

      // HARD LOG: Research execution mode and frequency with Top 25 verification
      logger.info({
        uid,
        activeMode: mode === RESEARCH_MODE.AUTO_TRADE_RESEARCH ? 'AUTO_TRADE' : 'TELEGRAM_BACKGROUND',
        mode,
        accuracyTrigger,
        frequencyMinutes,
        frequencySource: mode === RESEARCH_MODE.AUTO_TRADE_RESEARCH ? 'AUTO_TRADE' : 'TELEGRAM',
        telegramEngineActive: mode === RESEARCH_MODE.TELEGRAM_BACKGROUND_RESEARCH,
        autoTradeEngineActive: mode === RESEARCH_MODE.AUTO_TRADE_RESEARCH,
        top25Restriction: true,
        timestamp: new Date().toISOString()
      }, '🚀 [RESEARCH_START] Starting background research - active mode, frequency source, and accuracy trigger logged');

      // CRITICAL: Use Top 100 Accuracy Scan for background research
      // DELEGATION: We now delegate the actual research and trading execution to AutoTradeEngine
      // This ensures single source of truth and prevents duplicate loops
      // BackgroundResearchScheduler handles the SCHEDULING and ALERTING
      // AutoTradeEngine handles the RESEARCH and TRADING

      const { autoTradeEngine } = await import('./autoTradeEngine');

      logger.info({ uid, mode }, '🔄 [DELEGATION] Calling AutoTradeEngine for research cycle');
      console.log('🔥 [HARD_LOG] [RESEARCH_DELEGATE] Delegating to AutoTradeEngine for user:', uid, 'mode:', mode);

      // CRITICAL: Check for decryption failure cache to prevent retry loops
      // If decryption failed recently, skip this cycle to prevent event loop lag
      const failureCache = this.decryptionFailureCache.get(uid);
      console.log('🔥 [HARD_LOG] [DECRYPTION_CHECK] Checking decryption failure cache for user:', uid, 'hasCache:', !!failureCache, 'disabled:', failureCache?.disabled);
      if (failureCache?.disabled) {
        const timeSinceFailure = Date.now() - failureCache.lastFailureTime.getTime();
        const cooldownMinutes = 30; // Wait 30 minutes before retrying decryption
        if (timeSinceFailure < cooldownMinutes * 60 * 1000) {
          logger.warn({
            uid,
            mode,
            timeSinceFailureMinutes: Math.floor(timeSinceFailure / 60000),
            cooldownMinutes,
            failureCount: failureCache.failureCount
          }, '⏭️ [DECRYPTION_FAILURE_GUARD] Skipping research cycle - decryption failure detected, waiting for cooldown to prevent retry loop');
          console.log('🔥 [HARD_LOG] [DECRYPTION_BLOCKED] Research blocked by decryption failure cooldown for user:', uid);
          return;
        } else {
          // Cooldown expired, clear cache and retry
          logger.info({ uid, cooldownMinutes }, '✅ [DECRYPTION_FAILURE_GUARD] Cooldown expired, clearing cache and retrying');
          console.log('🔥 [HARD_LOG] [DECRYPTION_COOLDOWN_EXPIRED] Cooldown expired, clearing cache for user:', uid);
          this.decryptionFailureCache.delete(uid);
        }
      }

      // CRITICAL: Research ALWAYS runs regardless of accuracy
      // Accuracy is an OUTPUT, not a prerequisite
      // CRITICAL: For Telegram mode, skip AutoTradeEngine history storage (we'll store with correct source)
      // For Auto-Trade mode, AutoTradeEngine stores with source='AUTO_TRADE'
      const skipHistoryStorage = mode === RESEARCH_MODE.TELEGRAM_BACKGROUND_RESEARCH;
      console.log('🔥 [HARD_LOG] [RESEARCH_EXEC_START] Starting research execution for user:', uid, 'skipHistoryStorage:', skipHistoryStorage);

      // CRITICAL: Execute based on mode - COMPLETELY ISOLATED LOGIC
      let deepResearchResult: any = null;
      let executionError: any = null;

      try {
        if (mode === RESEARCH_MODE.AUTO_TRADE_RESEARCH) {
          // AUTO_TRADE_RESEARCH: Full execution with trading logic
          console.log('🔥 [HARD_LOG] [AUTO_TRADE_EXEC] Starting AUTO_TRADE_RESEARCH execution for user:', uid);
          deepResearchResult = await autoTradeEngine.runAutoTradeResearchCycleSafe(uid, false); // Store history
        } else if (mode === RESEARCH_MODE.TELEGRAM_BACKGROUND_RESEARCH) {
          // TELEGRAM_BACKGROUND_RESEARCH: Research only, no trading
          console.log('🔥 [HARD_LOG] [TELEGRAM_EXEC] Starting TELEGRAM_BACKGROUND_RESEARCH execution for user:', uid);
          deepResearchResult = await autoTradeEngine.runAutoTradeResearchCycleSafe(uid, true); // Skip history (we'll store)
        } else {
          // Unknown mode - should not happen
          logger.error({ uid, mode }, '❌ [SCHEDULER] Unknown mode in processUserResearch');
          throw new Error(`Unknown research mode: ${mode}`);
        }
      } catch (researchErr: any) {
        executionError = researchErr;
        logger.warn({ uid, mode, error: researchErr.message }, '⚠️ [SCHEDULER] Research execution failed, continuing with state update');
      }

      const researchNow = admin.firestore.Timestamp.now();
      let maxAccuracy = 0;
      let alertsSent = 0;

      console.log('🔥 [HARD_LOG] [RESEARCH_RESULT_CHECK] Checking research result for user:', uid, 'result exists:', !!deepResearchResult);

      // CRITICAL: If auto-trade cycle was skipped (deepResearchResult is null) and mode is AUTO_TRADE,
      // STOP execution cleanly - no further research, no Telegram logic, no duplicate history
      if (!deepResearchResult && mode === RESEARCH_MODE.AUTO_TRADE_RESEARCH) {
        logger.info({ uid, mode }, '🚫 [AUTO_TRADE_SKIP] Auto-trade cycle was skipped - stopping execution cleanly');

        // Update state and exit - AutoTradeEngine already saved SKIPPED history
        if (jobState) {
          jobState.isRunning = false;
          jobState.lastRunAt = researchNow.toDate();
          const frequencyMinutes = settings?.researchFrequencyMinutes || 5;
          jobState.nextRunAt = new Date(Date.now() + (frequencyMinutes * 60 * 1000));
        }

        // Update Firestore state
        try {
          await firestoreAdapter.saveBackgroundResearchSettings(uid, {
            lastRunAt: researchNow,
            nextRunAt: admin.firestore.Timestamp.fromMillis(Date.now() + ((settings?.researchFrequencyMinutes || 5) * 60 * 1000)),
            lastAccuracy: 0,
          });
        } catch (updateError: any) {
          logger.warn({ uid, error: updateError.message }, 'Failed to update state for auto-trade skip');
        }

        return; // STOP EXECUTION - Auto-trade was skipped, no further processing needed
      }

      // CRITICAL: Research cycle completed - update state regardless of result
      // Even if research returned null (no signal), the cycle ran successfully
      if (!deepResearchResult) {
        logger.info({ uid, mode }, '📊 [RESEARCH] Research cycle completed - no signal generated');
        console.log('🔥 [HARD_LOG] [RESEARCH_NO_RESULT] Research returned null for user:', uid);

        // CRITICAL: Store history ONLY for TELEGRAM_BACKGROUND mode
        // AUTO_TRADE mode: AutoTradeEngine already saved history (skipHistoryStorage=false)
        // TELEGRAM_BACKGROUND mode: Scheduler must save history (skipHistoryStorage=true)
        if (mode === RESEARCH_MODE.TELEGRAM_BACKGROUND_RESEARCH) {
          try {
            // CRITICAL FIX: When no coin is selected, use null symbol (NO BTC fallback)
            // Ensure NO Firestore payload contains undefined values
            // symbol = null, accuracy = 0, tradePlan = null (all explicitly set, no undefined)
            await firestoreAdapter.storeResearchHistory(uid, {
              symbol: null, // Explicitly null when no coin selected (NO BTC fallback)
              signal: 'HOLD', // Explicitly defined signal
              accuracy: 0, // Explicitly 0 (not undefined)
              price: 0,
              tradePlan: null, // Explicitly null (not undefined)
              isDeepResearch: true,
              source: 'TELEGRAM_BACKGROUND',
              status: 'SKIPPED',
              skipReason: 'No signal generated'
            });

            logger.info({ uid, mode, source: 'TELEGRAM_BACKGROUND', symbol: null }, '✅ [HISTORY] No-signal TELEGRAM_BACKGROUND history stored');
          } catch (histError: any) {
            logger.warn({ uid, error: histError.message }, 'Failed to store TELEGRAM_BACKGROUND history for no-signal cycle');
          }
        } else if (mode === RESEARCH_MODE.AUTO_TRADE_RESEARCH) {
          // AUTO_TRADE mode: AutoTradeEngine already saved history, NO duplicate save needed
          logger.info({
            uid,
            mode,
            duplicatePrevented: true
          }, '✅ [HISTORY_GUARD] AUTO_TRADE history already saved by AutoTradeEngine - no duplicate save needed');
        }

        // Update state - research cycle ran successfully
        if (jobState) {
          jobState.isRunning = false;
          jobState.lastRunAt = new Date();
          // CRITICAL: Update nextRunAt to ensure scheduler continues
          const frequencyMinutes = settings?.researchFrequencyMinutes || 5;
          jobState.nextRunAt = new Date(Date.now() + (frequencyMinutes * 60 * 1000));
          console.log('🔥 [HARD_LOG] [PROCESS_COMPLETE_NO_RESULT] processUserResearch() completed (no result) for user:', uid, 'jobState updated');
          // CRITICAL: Verify interval still exists - if missing, log warning (will be recreated on next check)
          if (!this.userIntervals.has(uid)) {
            logger.warn({
              uid,
              mode,
              intervalMissing: true,
              schedulerWillRecover: true
            }, '⚠️ [SCHEDULER_IMMORTAL] Interval missing after research cycle - will be recreated on next checkAndScheduleUserResearch cycle');
            console.log('🔥 [HARD_LOG] [INTERVAL_MISSING] Interval missing after research cycle for user:', uid);
          }
        }
      } else {
        console.log('🔥 [HARD_LOG] [RESEARCH_HAS_RESULT] Research returned valid result for user:', uid, 'symbol:', deepResearchResult.symbol);
        const coin = deepResearchResult.symbol;

        // CRITICAL: Extract FINAL accuracy from Deep Research verdict ONLY
        // Do NOT use partial, interim, or trend confidence values
        const finalAccuracy = typeof deepResearchResult.accuracy === 'number'
          ? deepResearchResult.accuracy
          : parseFloat(deepResearchResult.accuracy as any) || 0;

        const finalAccuracyPercent = Math.round(finalAccuracy > 1 ? finalAccuracy : finalAccuracy * 100);
        const signal = deepResearchResult.signal || 'HOLD';

        // CRITICAL: TOP 25 COIN RESTRICTION - Block non-top-25 coins (single source of truth)
        try {
          const { getTop100Coins } = await import('./researchModes');
          const top25 = await getTop100Coins(uid, 25);
          const normalizedCoin = coin.toUpperCase();
          const isTop25 = top25.some(c => c.symbol === normalizedCoin);

          if (!isTop25) {
            logger.error({
              uid,
              coin: normalizedCoin,
              top25Symbols: top25.map(c => c.symbol),
              stack: new Error().stack
            }, '❌ [TOP_25_BLOCK] Telegram alert blocked - symbol not in top 25 high-liquidity non-stablecoins by market cap');

            // CRITICAL: Update state and write history even for top-25 filter early return
            const now = admin.firestore.Timestamp.now();
            const frequencyMinutes = settings?.researchFrequencyMinutes || 5;
            const nextRunAt = admin.firestore.Timestamp.fromMillis(
              Date.now() + (frequencyMinutes * 60 * 1000)
            );

            maxAccuracy = finalAccuracyPercent;
            if (jobState) {
              jobState.isRunning = false;
              jobState.lastRunAt = now.toDate();
              jobState.nextRunAt = nextRunAt.toDate();
              // CRITICAL: Verify interval still exists
              if (!this.userIntervals.has(uid)) {
                logger.warn({ uid, mode, intervalMissing: true, schedulerWillRecover: true }, '⚠️ [SCHEDULER_IMMORTAL] Interval missing - will be recreated on next check');
              }
            }

            // Write history for top-25 filter skip
            try {
              await firestoreAdapter.storeResearchHistory(uid, {
                symbol: normalizedCoin,
                signal: signal || 'HOLD',
                accuracy: finalAccuracyPercent,
                price: 0,
                tradePlan: null,
                isDeepResearch: true,
                source: mode === RESEARCH_MODE.AUTO_TRADE_RESEARCH ? 'AUTO_TRADE' : 'TELEGRAM_BACKGROUND',
                status: 'SKIPPED',
                skipReason: 'Symbol not in top 25 high-liquidity coins'
              });
            } catch (histError: any) {
              logger.warn({ uid, coin: normalizedCoin, error: histError.message }, 'Failed to store top-25 filter history');
            }

            // Update Firestore state
            try {
              await firestoreAdapter.saveBackgroundResearchSettings(uid, {
                lastRunAt: now,
                nextRunAt,
                lastAccuracy: finalAccuracyPercent,
              });
            } catch (updateError: any) {
              logger.warn({ uid, error: updateError.message }, 'Failed to update state for top-25 filter');
            }

            return; // Exit early - do not process non-top-25 coins
          }
        } catch (top25CheckError: any) {
          logger.error({ uid, coin, error: top25CheckError.message, stack: top25CheckError.stack }, '❌ [TOP_25_ERROR] Error checking top 25 - blocking alert for safety');

          // CRITICAL: Update state and write history even for top-25 error early return
          const now = admin.firestore.Timestamp.now();
          const frequencyMinutes = settings?.researchFrequencyMinutes || 5;
          const nextRunAt = admin.firestore.Timestamp.fromMillis(
            Date.now() + (frequencyMinutes * 60 * 1000)
          );

          maxAccuracy = finalAccuracyPercent;
          if (jobState) {
            jobState.isRunning = false;
            jobState.lastRunAt = now.toDate();
            jobState.nextRunAt = nextRunAt.toDate();
            // CRITICAL: Verify interval still exists
            if (!this.userIntervals.has(uid)) {
              logger.warn({ uid, mode, intervalMissing: true, schedulerWillRecover: true }, '⚠️ [SCHEDULER_IMMORTAL] Interval missing - will be recreated on next check');
            }
          }

          // Write history for top-25 error skip
          try {
            await firestoreAdapter.storeResearchHistory(uid, {
              symbol: coin,
              signal: signal || 'HOLD',
              accuracy: finalAccuracyPercent,
              price: 0,
              tradePlan: null,
              isDeepResearch: true,
              source: mode === RESEARCH_MODE.AUTO_TRADE_RESEARCH ? 'AUTO_TRADE' : 'TELEGRAM_BACKGROUND',
              status: 'SKIPPED',
              skipReason: 'Top 25 check error - blocking for safety'
            });
          } catch (histError: any) {
            logger.warn({ uid, coin, error: histError.message }, 'Failed to store top-25 error history');
          }

          // Update Firestore state
          try {
            await firestoreAdapter.saveBackgroundResearchSettings(uid, {
              lastRunAt: now,
              nextRunAt,
              lastAccuracy: finalAccuracyPercent,
            });
          } catch (updateError: any) {
            logger.warn({ uid, error: updateError.message }, 'Failed to update state for top-25 error');
          }

          return; // Exit early on error
        }

        // CRITICAL: Use tradePlan directly from research result (single source of truth)
        // Do NOT recompute or mutate - trust the finalized research result
        // deepResearchResult.result contains the full FreeModeDeepResearchResult
        const fullResult = deepResearchResult.result || {};
        const tradePlan = fullResult.tradePlan || null; // Explicitly null if not present
        const metadata = (fullResult.metadata || deepResearchResult.metadata || {}) as any;

        // Verify signal/tradePlan consistency
        if (signal === 'HOLD' && tradePlan !== null) {
          logger.error({ uid, coin, signal, tradePlan },
            '[TELEGRAM_VERIFY_ERROR] Signal is HOLD but tradePlan exists - this should never happen!');
        } else if (signal !== 'HOLD' && finalAccuracyPercent >= 60 && !tradePlan) {
          logger.error({ uid, coin, signal, accuracy: finalAccuracyPercent },
            '[TELEGRAM_VERIFY_ERROR] BUY/SELL signal with accuracy >= 60% but tradePlan is null!');
        } else {
          logger.info({ uid, coin, signal, accuracy: finalAccuracyPercent, hasTradePlan: tradePlan !== null },
            '[TELEGRAM_VERIFY] Signal and tradePlan consistency verified');
        }

        // WHALE ALERT: Check for large moves independently of auto-trade
        try {
          const userSettings = await firestoreAdapter.getSettings(uid);
          if (userSettings?.notifications?.whaleAlerts) {
            await autoTradeEngine.checkWhaleAlerts(uid, coin);
          }
        } catch (whaleErr) {
          // logger.warn({ uid, coin }, 'Failed to check whale alerts in background');
        }

        // Track max accuracy
        maxAccuracy = finalAccuracyPercent;

        // CRITICAL: Accuracy trigger is evaluated AFTER research completes
        // This is an output evaluation, not a prerequisite check
        const minTrigger = accuracyTrigger?.min ?? (typeof accuracyTrigger === 'number' ? accuracyTrigger : 80);
        const maxTrigger = accuracyTrigger?.max ?? 100;
        const isInRange = finalAccuracyPercent >= minTrigger && finalAccuracyPercent <= maxTrigger;

        // HARD LOG: Active mode and frequency source
        logger.info({
          uid,
          coin,
          activeMode: mode === RESEARCH_MODE.AUTO_TRADE_RESEARCH ? 'AUTO_TRADE' : 'TELEGRAM_BACKGROUND',
          frequencySource: mode === RESEARCH_MODE.AUTO_TRADE_RESEARCH ? 'AUTO_TRADE' : 'TELEGRAM',
          telegramEngineActive: mode === RESEARCH_MODE.TELEGRAM_BACKGROUND_RESEARCH,
          autoTradeEngineActive: mode === RESEARCH_MODE.AUTO_TRADE_RESEARCH,
          timestamp: new Date().toISOString()
        }, '📱 [TELEGRAM_MODE] Active mode determined - frequency source and engine selection logged');

        logger.info({
          coin,
          mode,
          finalAccuracy: finalAccuracyPercent,
          range: { min: minTrigger, max: maxTrigger },
          decision: isInRange ? 'QUALIFIED' : 'NOT_QUALIFIED',
          alertDecision: isInRange ? 'SEND_ALERT' : 'SKIP_ALERT',
          reason: isInRange ? 'Accuracy >= trigger' : `Accuracy ${finalAccuracyPercent}% outside range [${minTrigger}-${maxTrigger}]%`
        }, '🎯 [ACCURACY] Accuracy range evaluation (post-research) - alert decision based on accuracy >= trigger only');

        // 🔥 DEBUG: Log scheduler mode and accuracy trigger evaluation
        logger.info({
          uid,
          coin,
          mode,
          finalAccuracy: finalAccuracyPercent,
          minTrigger,
          maxTrigger,
          isInRange,
          accuracyTrigger: settings.accuracyTrigger
        }, '🔍 [SCHEDULER_DEBUG] Scheduler mode and accuracy trigger evaluation');

        // MODE-SPECIFIC HANDLING:
        // AUTO_TRADE_RESEARCH: Trade execution is handled by AutoTradeEngine.runAutoTradeResearchCycleSafe
        //   - AutoTradeEngine runs server-side, independent of frontend
        //   - Called by BackgroundResearchScheduler at configured frequency
        //   - Continues running when website is closed (server-side execution)
        //   - Only exchange decryption failure blocks execution (not UI state)
        //   - CRITICAL: Telegram alerts are sent FROM AutoTradeEngine, NOT from processUserResearch
        //   - This Telegram alert logic below is BYPASSED when mode is AUTO_TRADE_RESEARCH
        // TELEGRAM_BACKGROUND_RESEARCH: Send Telegram alert if accuracy >= trigger
        //   - Telegram alerts sent server-side, independent of frontend
        //   - Alerts trigger when FINAL accuracy crosses threshold
        //   - Uses ONLY background research settings (telegramBotToken, telegramChatId, accuracyTrigger)
        //   - Does NOT depend on UI being open, WebSocket connections, or frontend polling

        // CRITICAL: For AUTO_TRADE_RESEARCH mode, state update and history writing is handled below
        // Continue to the end of function for proper state management
        // Telegram alerts are handled by AutoTradeEngine, not here

        // 🔥 PROOF: Log mode and accuracy range check
        if (mode === RESEARCH_MODE.TELEGRAM_BACKGROUND_RESEARCH) {
          console.log("[TELEGRAM_BG_ACCURACY_CHECK]", {
            uid,
            symbol: coin,
            mode: 'TELEGRAM_BACKGROUND',
            accuracy: finalAccuracyPercent,
            minTrigger,
            maxTrigger,
            isInRange,
            timestamp: new Date().toISOString()
          });
        }

        if (mode === RESEARCH_MODE.TELEGRAM_BACKGROUND_RESEARCH && isInRange) {
          const alertId = `telegram_bg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

          // 🔥 PROOF: Log before Telegram send attempt
          console.log("[TELEGRAM_BG_BEFORE_SEND]", {
            alertId,
            uid,
            symbol: coin,
            mode: 'TELEGRAM_BACKGROUND',
            accuracy: finalAccuracyPercent,
            threshold: accuracyTrigger,
            isInRange,
            timestamp: new Date().toISOString()
          });

          logger.info({
            alertId,
            uid,
            symbol: coin,
            mode: 'TELEGRAM_BACKGROUND',
            accuracy: finalAccuracyPercent,
            threshold: accuracyTrigger
          }, '🎯 [ACCURACY] Accuracy condition met for Telegram alert');

          // CRITICAL: Alerts fire on EVERY research cycle when accuracy >= trigger
          // Removed spam prevention check - alerts must fire based on accuracy threshold ONLY
          // Trade execution is NOT required for alerts

          // CRITICAL: Hard guards for Telegram alert
          // Use ONLY background research settings - do NOT depend on notification settings
          // telegramBackgroundResearchEnabled is the source of truth for Telegram alerts in Background Research
          const telegramEnabled = settings.telegramBackgroundResearchEnabled === true ||
            (settings.backgroundResearchEnabled === true && settings.telegramBackgroundResearchEnabled !== false);
          const hasBotToken = !!settings.telegramBotToken && settings.telegramBotToken.trim().length > 0;
          const hasChatId = !!settings.telegramChatId && settings.telegramChatId.trim().length > 0;

          // 🔥 DEBUG: Log Telegram enablement state
          logger.info({
            uid,
            coin,
            mode: 'TELEGRAM_BACKGROUND_RESEARCH',
            telegramBackgroundResearchEnabled: settings.telegramBackgroundResearchEnabled,
            backgroundResearchEnabled: settings.backgroundResearchEnabled,
            telegramEnabled,
            hasBotToken,
            hasChatId,
            finalAccuracy: finalAccuracyPercent,
            isInRange
          }, '🔍 [TELEGRAM_DEBUG] Telegram alert enablement check');

          // 🔥 PROOF: Log skip reasons explicitly (both console and logger for visibility)
          if (!telegramEnabled) {
            const skipReason = 'TELEGRAM_DISABLED: Telegram Background Research not enabled';
            console.log("[TELEGRAM_BG_SKIPPED_REASON=telegram_disabled]", {
              alertId,
              uid,
              symbol: coin,
              telegramEnabled,
              timestamp: new Date().toISOString()
            });
            logger.info({
              alertId,
              uid,
              symbol: coin,
              mode: 'TELEGRAM_BACKGROUND',
              accuracy: finalAccuracyPercent,
              telegramBackgroundResearchEnabled: settings.telegramBackgroundResearchEnabled,
              backgroundResearchEnabled: settings.backgroundResearchEnabled,
              status: 'SKIPPED',
              reason: skipReason
            }, '⏭️ [TELEGRAM_ALERT_SKIPPED] Telegram background alert skipped - Telegram not enabled');
          } else if (!hasBotToken) {
            const skipReason = 'MISSING_BOT_TOKEN: Telegram bot token not configured';
            console.log("[TELEGRAM_BG_SKIPPED_REASON=missing_bot_token]", {
              alertId,
              uid,
              symbol: coin,
              hasBotToken,
              timestamp: new Date().toISOString()
            });
            logger.info({
              alertId,
              uid,
              symbol: coin,
              mode: 'TELEGRAM_BACKGROUND',
              accuracy: finalAccuracyPercent,
              hasBotToken,
              status: 'SKIPPED',
              reason: skipReason
            }, '⏭️ [TELEGRAM_ALERT_SKIPPED] Telegram background alert skipped - bot token missing');
          } else if (!hasChatId) {
            const skipReason = 'MISSING_CHAT_ID: Telegram chat ID not configured';
            console.log("[TELEGRAM_BG_SKIPPED_REASON=missing_chat_id]", {
              alertId,
              uid,
              symbol: coin,
              hasChatId,
              timestamp: new Date().toISOString()
            });
            logger.info({
              alertId,
              uid,
              symbol: coin,
              mode: 'TELEGRAM_BACKGROUND',
              accuracy: finalAccuracyPercent,
              hasChatId,
              status: 'SKIPPED',
              reason: skipReason
            }, '⏭️ [TELEGRAM_ALERT_SKIPPED] Telegram background alert skipped - chat ID missing');
          }

          if (telegramEnabled && hasBotToken && hasChatId) {
            // CRITICAL: Alerts must fire based on accuracy >= trigger ONLY
            // DO NOT check unifiedDecision.allowed - that's for trade execution, not alerts
            // DO NOT block alerts based on spam prevention - alerts should fire on EVERY qualifying cycle
            // Alert logic: IF accuracy >= trigger THEN send alert (simple rule)

            // CRITICAL: Write history BEFORE sending Telegram alert (guaranteed order)
            // This ensures history is always written before alert is sent
            try {
              // CRITICAL HARD GUARD 1: Verify isFinal === true before saving history
              // History must NEVER be saved for partial/intermediate results
              if (fullResult.isFinal !== true) {
                logger.error({
                  uid,
                  symbol: coin,
                  isFinal: fullResult.isFinal,
                  accuracy: finalAccuracyPercent,
                  signal
                }, '❌ [HISTORY_GUARD] BLOCKED: Telegram history save attempted with isFinal !== true - this is a partial/intermediate result');
                // Do NOT throw - log error and skip history save, but continue with Telegram alert
                // This prevents blocking alerts due to history validation failures
              } else {
                // CRITICAL HARD GUARD 2: Verify accuracy is a real computed value (not 0 unless genuinely computed)
                if (finalAccuracyPercent === 0 && signal !== 'HOLD') {
                  logger.error({
                    uid,
                    symbol: coin,
                    accuracy: finalAccuracyPercent,
                    signal,
                    isFinal: fullResult.isFinal
                  }, '❌ [HISTORY_GUARD] BLOCKED: Telegram history save attempted with accuracy=0 and signal !== HOLD - invalid state');
                  // Do NOT throw - log error and skip history save, but continue with Telegram alert
                } else {
                  const historyPrice = metadata?.price || fullResult.price || 0;
                  const historyEntry = {
                    symbol: coin,
                    signal: signal || 'HOLD',
                    accuracy: finalAccuracyPercent,
                    price: historyPrice,
                    tradePlan: (finalAccuracyPercent >= 70 && tradePlan) ? tradePlan : null,
                    entryPrice: (finalAccuracyPercent >= 70 && tradePlan?.entryPrice) ? tradePlan.entryPrice : 0,
                    stopLoss: (finalAccuracyPercent >= 70 && tradePlan?.stopLoss) ? tradePlan.stopLoss : 0,
                    takeProfit: (finalAccuracyPercent >= 70 && tradePlan?.takeProfit) ? tradePlan.takeProfit : 0,
                    takeProfit1: (finalAccuracyPercent >= 70 && tradePlan?.takeProfit1) ? tradePlan.takeProfit1 : 0,
                    takeProfit2: (finalAccuracyPercent >= 70 && tradePlan?.takeProfit2) ? tradePlan.takeProfit2 : 0,
                    takeProfit3: (finalAccuracyPercent >= 70 && tradePlan?.takeProfit3) ? tradePlan.takeProfit3 : 0,
                    indicators: fullResult.analysis || null,
                    isDeepResearch: true,
                    source: 'TELEGRAM_BACKGROUND',
                    isFinal: true // CRITICAL: Explicitly mark as final for history validation
                  };

                  await firestoreAdapter.storeResearchHistory(uid, historyEntry);
                  logger.info({ uid, symbol: coin, accuracy: finalAccuracyPercent }, '✅ [HISTORY] Telegram background research history stored');
                }
              }
            } catch (histErr: any) {
              logger.error({ uid, symbol: coin, error: histErr.message }, '❌ [HISTORY] Failed to store Telegram background history');
              // Continue with Telegram alert even if history fails
            }

            logger.info({
              alertId,
              uid,
              symbol: coin,
              mode: 'TELEGRAM_BACKGROUND',
              accuracy: finalAccuracyPercent,
              accuracyTrigger: accuracyTrigger,
              thresholdMet: isInRange,
              frequencySource: 'TELEGRAM',
              status: 'ATTEMPT',
              reason: 'Accuracy >= trigger, alert sent on research completion'
            }, '📱 [TELEGRAM_ALERT_SEND] Sending Telegram alert - accuracy >= trigger, all guards passed (history written)');

            // CRITICAL: Telegram message must match UI exactly
            // If signal is HOLD, show HOLD clearly with no prices
            // If signal is BUY/SELL, show full trade plan with TP1/TP2/TP3
            const timestamp = new Date().toISOString();
            let message = '';

            if (signal === 'HOLD') {
              // HOLD signal: No prices, clear HOLD message
              message = `🚨 *DLXTRADE Background Research Alert*

**Coin:** ${coin}
**Signal:** HOLD
**Accuracy:** ${finalAccuracyPercent}%
**Reason:** Accuracy below 60% threshold - no trade plan generated
**Timestamp:** ${timestamp}

⚡ *Action:* Wait for higher confidence signal before trading.`;

              logger.info({ uid, coin, accuracy: finalAccuracyPercent },
                '[TELEGRAM] Sending HOLD signal (no trade plan)');
            } else {
              // BUY/SELL signal: Full trade plan with TP1/TP2/TP3
              // Validate trade plan exists and has required fields
              if (!tradePlan || !tradePlan.entryPrice || !tradePlan.stopLoss) {
                logger.error({ uid, coin, signal, accuracy: finalAccuracyPercent, tradePlan },
                  '[TELEGRAM_ERROR] BUY/SELL signal but trade plan is missing or incomplete!');
                // Fallback: Send HOLD message instead
                message = `🚨 *DLXTRADE Background Research Alert*

**Coin:** ${coin}
**Signal:** HOLD (Trade plan generation failed)
**Accuracy:** ${finalAccuracyPercent}%
**Timestamp:** ${timestamp}

⚡ *Action:* Trade plan unavailable - signal not actionable.`;
              } else {
                // BUY/SELL signal: Show trade plan if accuracy meets user's Telegram trigger (not hardcoded 70%)
                // CRITICAL: Trade plan should be shown when accuracy >= user's Telegram accuracy trigger
                let entryPrice: number | undefined;
                let stopLoss: number | undefined;
                let tp1: number | undefined;
                let tp2: number | undefined;
                let tp3: number | undefined;

                // Use user's Telegram accuracy trigger (already calculated as minTrigger)
                if (finalAccuracyPercent >= minTrigger) {
                  // BUY/SELL with valid trade plan and accuracy >= 70% - show full TP1/TP2/TP3
                  entryPrice = tradePlan.entryPrice;
                  stopLoss = tradePlan.stopLoss;
                  tp1 = tradePlan.takeProfit1;
                  tp2 = tradePlan.takeProfit2;
                  tp3 = tradePlan.takeProfit3;

                  // Format prices with dynamic precision to prevent identical values
                  const formatPrice = (price: number): string => {
                    if (!price || price <= 0) return '0.00';
                    if (price >= 1000) return price.toFixed(2);
                    if (price >= 100) return price.toFixed(3);
                    if (price >= 10) return price.toFixed(4);
                    if (price >= 1) return price.toFixed(5);
                    return price.toFixed(6);
                  };

                  message = `🚨 *DLXTRADE Background Research Alert*

**Coin:** ${coin}
**Signal:** ${signal}
**Accuracy:** ${finalAccuracyPercent}%
**Entry Price:** $${formatPrice(entryPrice)}
**Stop Loss:** $${formatPrice(stopLoss)}
**Take Profit 1:** ${tp1 ? `$${formatPrice(tp1)}` : 'N/A'}
**Take Profit 2:** ${tp2 ? `$${formatPrice(tp2)}` : 'N/A'}${tp3 ? `\n**Take Profit 3:** $${formatPrice(tp3)}` : ''}
**Timestamp:** ${timestamp}

⚡ *Action Required:* Position size adjusted dynamically. Review and execute if conditions remain favorable.`;
                } else {
                  // BUY/SELL signal but accuracy < 70% - don't show trade plan
                  message = `🚨 *DLXTRADE Background Research Alert*

**Coin:** ${coin}
**Signal:** ${signal}
**Accuracy:** ${finalAccuracyPercent}%
**Reason:** Accuracy below 70% threshold - trade plan not generated
**Timestamp:** ${timestamp}

⚡ *Action:* Wait for higher confidence signal (>= 70%) before trading.`;
                }

                logger.info({ uid, coin, signal, accuracy: finalAccuracyPercent, entryPrice, stopLoss, tp1, tp2, tp3 },
                  '[TELEGRAM] Sending BUY/SELL signal with full trade plan (TP1/TP2/TP3)');
              }
            }

            // CRITICAL: Send Telegram alert using existing service
            // sendMessage signature: (botToken: string, chatId: string, message: string)
            const telegramResult = await telegramService.sendMessage(
              settings.telegramBotToken!,
              settings.telegramChatId!,
              message
            );

            // 🔥 DEBUG: Log Telegram alert attempt
            logger.info({
              alertId,
              uid,
              symbol: coin,
              mode: 'TELEGRAM_BACKGROUND',
              accuracy: finalAccuracyPercent,
              success: telegramResult.success
            }, '🔍 [TELEGRAM_BG_DEBUG] Telegram alert send attempt');

            if (telegramResult.success) {
              alertsSent++;

              // Update last alert sent timestamp
              const updatedLastAlertSent = {
                ...(settings.lastAlertSent || {}),
                [coin]: {
                  timestamp: now,
                  accuracy: finalAccuracyPercent,
                },
              };

              // CRITICAL: Build clean object without undefined values
              const cleanAlertSettings: any = {
                backgroundResearchEnabled: settings.backgroundResearchEnabled,
                lastAlertSent: updatedLastAlertSent,
              };
              // Only include defined fields
              if (settings.telegramBotToken !== undefined) cleanAlertSettings.telegramBotToken = settings.telegramBotToken;
              if (settings.telegramChatId !== undefined) cleanAlertSettings.telegramChatId = settings.telegramChatId;
              if (settings.researchFrequencyMinutes !== undefined) cleanAlertSettings.researchFrequencyMinutes = settings.researchFrequencyMinutes;
              if (settings.accuracyTrigger !== undefined) cleanAlertSettings.accuracyTrigger = settings.accuracyTrigger;
              if (settings.selectedCoins !== undefined) cleanAlertSettings.selectedCoins = settings.selectedCoins;

              await firestoreAdapter.saveBackgroundResearchSettings(uid, cleanAlertSettings);

              logger.info({
                alertId,
                uid,
                symbol: coin,
                mode: 'TELEGRAM_BACKGROUND',
                accuracy: finalAccuracyPercent,
                accuracyTrigger: accuracyTrigger,
                thresholdMet: isInRange,
                frequencySource: 'TELEGRAM',
                status: 'SENT',
                reason: 'Alert sent successfully - accuracy >= trigger on research completion'
              }, '✅ [TELEGRAM_ALERT_SENT] Telegram background research alert sent successfully - accuracy >= trigger');
            } else {
              logger.error({
                alertId,
                uid,
                symbol: coin,
                mode: 'TELEGRAM_BACKGROUND',
                accuracy: finalAccuracyPercent,
                status: 'FAILED',
                error: telegramResult.error
              }, '❌ [TELEGRAM_ALERT_FAILED] Telegram alert failed after retries');
            }
          } else {
            // Log exact reason for skipping with structured logging
            let reason = '';
            if (!telegramEnabled) reason = 'Telegram disabled in settings';
            else if (!hasBotToken) reason = 'Telegram bot token missing';
            else if (!hasChatId) reason = 'Telegram chat ID missing';
            else if (!isInRange) reason = `Accuracy ${finalAccuracyPercent}% outside trigger range`;
            else reason = 'Unknown reason';

            logger.info({
              alertId,
              uid,
              symbol: coin,
              mode: 'TELEGRAM_BACKGROUND',
              accuracy: finalAccuracyPercent,
              accuracyTrigger: accuracyTrigger,
              thresholdMet: isInRange,
              frequencySource: 'TELEGRAM',
              status: 'SKIPPED',
              reason
            }, '⏭️ [TELEGRAM_ALERT_SKIPPED] Telegram background alert skipped');
          }
        } else if (mode === RESEARCH_MODE.AUTO_TRADE_RESEARCH) {
          // AUTO_TRADE_RESEARCH mode: 
          // - Trade execution is handled by AutoTradeEngine
          // - Telegram alerts are handled by AutoTradeEngine (based on telegramAccuracyTrigger)
          // - History is already stored by AutoTradeEngine with source='AUTO_TRADE' (skipHistoryStorage=false)
          // CRITICAL: Telegram background research engine is COMPLETELY DISABLED in this mode
          // No Telegram alerts should be sent from the scheduler in AUTO_TRADE_RESEARCH mode
          // 
          // AUTO-TRADE LIFECYCLE DOCUMENTATION:
          // - AutoTradeEngine.runAutoTradeResearchCycleSafe() is called by BackgroundResearchScheduler
          // - Runs server-side independently of frontend
          // - Survives user logout, tab close, or browser shutdown
          // - Does NOT depend on WebSocket connections, frontend polling, or UI presence
          // - Only exchange decryption failure blocks execution (not UI state)
          // - Execution continues when website is closed
          logger.info({
            uid,
            coin,
            finalAccuracy: finalAccuracyPercent,
            signal,
            isInRange,
            serverSide: true,
            frontendIndependent: true
          }, '🎯 [AUTO_TRADE] Research cycle completed - trade execution, Telegram alerts, and history handled by AutoTradeEngine (server-side)');

          // 🔥 DEBUG: Log auto-trade execution confirmation
          logger.info({
            uid,
            coin,
            mode: 'AUTO_TRADE_RESEARCH',
            serverSide: true,
            frontendIndependent: true
          }, '🔍 [AUTO_TRADE_LIFECYCLE_DEBUG] Auto-Trade execution - server-side only');
        }

        // CRITICAL: For TELEGRAM_BACKGROUND_RESEARCH mode, store history with correct source
        // AutoTradeEngine was called with skipHistoryStorage=true, so we must store here
        if (mode === RESEARCH_MODE.TELEGRAM_BACKGROUND_RESEARCH && deepResearchResult) {
          try {
            // CRITICAL HARD GUARD 1: Verify isFinal === true before saving history
            if (fullResult.isFinal !== true) {
              logger.error({
                uid,
                symbol: coin,
                isFinal: fullResult.isFinal,
                accuracy: finalAccuracyPercent,
                signal
              }, '❌ [HISTORY_GUARD] BLOCKED: Telegram history save attempted with isFinal !== true - this is a partial/intermediate result');
              // Skip history save but continue execution
            } else if (finalAccuracyPercent === 0 && signal !== 'HOLD') {
              // CRITICAL HARD GUARD 2: Verify accuracy is a real computed value
              logger.error({
                uid,
                symbol: coin,
                accuracy: finalAccuracyPercent,
                signal,
                isFinal: fullResult.isFinal
              }, '❌ [HISTORY_GUARD] BLOCKED: Telegram history save attempted with accuracy=0 and signal !== HOLD - invalid state');
              // Skip history save but continue execution
            } else {
              const historyPrice = fullResult.price ||
                fullResult.analysis?.priceAction?.currentPrice ||
                fullResult.analysis?.priceAction?.price ||
                fullResult.indicators?.price ||
                fullResult.metadata?.price ||
                0;

              await firestoreAdapter.storeResearchHistory(uid, {
                symbol: coin,
                signal: signal || 'HOLD',
                accuracy: finalAccuracyPercent,
                price: historyPrice,
                tradePlan: tradePlan,
                indicators: fullResult.analysis || null,
                isDeepResearch: true,
                source: 'TELEGRAM_BACKGROUND', // CRITICAL: Mark as Telegram background research
                status: 'FINAL', // Research completed successfully
                isFinal: true // CRITICAL: Explicitly mark as final for history validation
              });

              logger.info({ uid, coin, signal, accuracy: finalAccuracyPercent }, '✅ [HISTORY] Telegram background research history stored');
            }
          } catch (histError: any) {
            logger.warn({ uid, error: histError.message }, 'Failed to store Telegram background research history');
          }
        }
      }

      // Calculate next run time
      const researchNextRunAt = admin.firestore.Timestamp.fromMillis(
        Date.now() + (frequencyMinutes * 60 * 1000)
      );

      // CRITICAL: Update state in backend (lastRunAt, nextRunAt, lastAccuracy) - build clean object
      // CRITICAL: Do NOT mutate user enable flags - only update runtime state
      // firestoreAdapter.saveBackgroundResearchSettings will preserve enable flags automatically
      const cleanUpdateSettings: any = {
        // CRITICAL: Only update runtime state - do NOT include enable flags
        // firestoreAdapter.saveBackgroundResearchSettings preserves existing enable flags
        lastRunAt: researchNow,
        nextRunAt: researchNextRunAt,
        lastAccuracy: maxAccuracy,
      };
      // Only include defined fields (preserve Telegram credentials and other settings)
      if (settings.telegramBotToken !== undefined) cleanUpdateSettings.telegramBotToken = settings.telegramBotToken;
      if (settings.telegramChatId !== undefined) cleanUpdateSettings.telegramChatId = settings.telegramChatId;
      if (settings.researchFrequencyMinutes !== undefined) cleanUpdateSettings.researchFrequencyMinutes = settings.researchFrequencyMinutes;
      if (settings.accuracyTrigger !== undefined) cleanUpdateSettings.accuracyTrigger = settings.accuracyTrigger;
      if (settings.selectedCoins !== undefined) cleanUpdateSettings.selectedCoins = settings.selectedCoins;
      // CRITICAL: Do NOT include backgroundResearchEnabled or telegramBackgroundResearchEnabled
      // These are user-controlled flags and should NOT be mutated by scheduler

      await firestoreAdapter.saveBackgroundResearchSettings(uid, cleanUpdateSettings);

      // CRITICAL: Update in-memory state - ALWAYS update lastRunAt to track research cycle
      const state = this.userJobStates.get(uid);
      if (state) {
        state.lastRunAt = researchNow.toDate();
        state.nextRunAt = researchNextRunAt.toDate();
        state.isRunning = false;
      } else {
        // Initialize state if it doesn't exist
        this.userJobStates.set(uid, {
          isRunning: false,
          lastRunAt: researchNow.toDate(),
          nextRunAt: researchNextRunAt.toDate(),
          mode: mode as any
        });
      }

      logger.info({
        uid,
        maxAccuracy,
        alertsSent,
        nextRunAt: researchNextRunAt.toDate().toISOString()
      }, '✅ [RESEARCH] Background research cycle completed (Delegate Mode)');
      console.log('🔥 [HARD_LOG] [PROCESS_COMPLETE_FINAL] processUserResearch() completed successfully for user:', uid, 'maxAccuracy:', maxAccuracy, 'alertsSent:', alertsSent);

    } catch (error: any) {
      console.log('🔥 [HARD_LOG] [PROCESS_ERROR_FINAL] processUserResearch() error for user:', uid, 'error:', error?.message);
      logger.error({
        error: error.message,
        uid,
        stack: error.stack
      }, '❌ [RESEARCH] Error processing user background research');

      // CRITICAL: Update state even on error - research cycle attempted
      // This ensures scheduler continues and diagnostics don't show "stalled"
      const state = this.userJobStates.get(uid);
      const errorSettings = await firestoreAdapter.getBackgroundResearchSettings(uid);
      const errorNow = admin.firestore.Timestamp.now();
      const errorFrequencyMinutes = errorSettings?.researchFrequencyMinutes || 5;
      const errorNextRunAt = admin.firestore.Timestamp.fromMillis(
        Date.now() + (errorFrequencyMinutes * 60 * 1000)
      );

      // CRITICAL: Store history even on error (research was attempted)
      // Use mode from jobState if available, otherwise try to detect from Firestore
      let mode = (state as any)?.mode || null;
      if (!mode) {
        try {
          const db = getFirebaseAdmin().firestore();
          const autoTradeConfigDoc = await db.collection('users').doc(uid).collection('autoTradeConfig').doc('current').get();
          const autoTradeConfig = autoTradeConfigDoc.exists ? autoTradeConfigDoc.data() : null;
          const autoTradeEnabled = autoTradeConfig?.autoTradeEnabled === true;
          mode = autoTradeEnabled ? RESEARCH_MODE.AUTO_TRADE_RESEARCH : RESEARCH_MODE.TELEGRAM_BACKGROUND_RESEARCH;
        } catch (modeError: any) {
          logger.warn({ uid, error: modeError.message }, 'Failed to detect mode for error history');
          mode = RESEARCH_MODE.TELEGRAM_BACKGROUND_RESEARCH; // Safe fallback
        }
      }

      try {
        const historySource = mode === RESEARCH_MODE.TELEGRAM_BACKGROUND_RESEARCH
          ? 'TELEGRAM_BACKGROUND'
          : 'AUTO_TRADE';

        await firestoreAdapter.storeResearchHistory(uid, {
          symbol: 'ERROR_CYCLE',
          signal: 'HOLD',
          accuracy: 0,
          price: 0,
          tradePlan: null,
          isDeepResearch: true,
          source: historySource,
          status: 'SKIPPED',
          error: error.message,
          skipReason: 'Research cycle error'
        });
      } catch (histError: any) {
        logger.warn({ uid, error: histError.message }, 'Failed to store history for error cycle');
      }

      if (state) {
        state.isRunning = false;
        state.lastRunAt = errorNow.toDate(); // Update lastRunAt even on error
        state.nextRunAt = errorNextRunAt.toDate();
      } else {
        // Initialize state if it doesn't exist - use detected mode
        this.userJobStates.set(uid, {
          isRunning: false,
          lastRunAt: errorNow.toDate(),
          nextRunAt: errorNextRunAt.toDate(),
          mode: mode as any
        });
      }

      // CRITICAL: Update Firestore state even on error
      try {
        await firestoreAdapter.saveBackgroundResearchSettings(uid, {
          lastRunAt: errorNow,
          nextRunAt: errorNextRunAt,
          lastAccuracy: 0,
        });
      } catch (updateError: any) {
        logger.warn({ uid, error: updateError.message }, 'Failed to update state after error');
      }
    }
  }

  /**
   * Check if Telegram alert should be sent (spam prevention)
   * CRITICAL: Cooldown is absolute (time-based) - allows re-alert after cooldown
   * even if accuracy delta < 5%
   */
  private shouldSendTelegramAlert(
    lastAlert: { timestamp: admin.firestore.Timestamp; accuracy: number } | undefined,
    currentAccuracy: number,
    currentTime: admin.firestore.Timestamp
  ): boolean {
    if (!lastAlert) {
      // No previous alert for this coin, send it
      return true;
    }

    // PRD REQUIREMENT: Re-alert ONLY if accuracy improves.
    // This is a strict rule to prevent spamming the user with decreasing or oscillating accuracy.
    if (currentAccuracy > lastAlert.accuracy) {
      logger.info({
        currentAccuracy,
        lastAccuracy: lastAlert.accuracy,
        reason: 'accuracy improved'
      }, '✅ [TELEGRAM] Accuracy improved, allowing re-alert');
      return true;
    }

    // Check absolute cooldown as a secondary factor?
    // PRD says "re-alert ONLY if accuracy improves", which implies even if cooldown passed, if accuracy hasn't improved, don't alert.
    // However, usually we want to know if it's STILL good after a long time.
    // Let's stick to the STRICT PRD interpretation: re-alert ONLY if accuracy improves.

    // Note: If you want to allow re-alerting after a long time even without improvement, add:
    // const minutesSinceLastAlert = (currentTime.toDate().getTime() - lastAlert.timestamp.toDate().getTime()) / (60 * 1000);
    // if (minutesSinceLastAlert >= this.COOLDOWN_MINUTES) return true;

    logger.debug({
      currentAccuracy,
      lastAccuracy: lastAlert.accuracy,
      reason: 'accuracy did not improve'
    }, '⏭️ [TELEGRAM] Alert blocked - accuracy did not improve since last alert for this coin');
    return false;
  }

  /**
   * Process Telegram background research results (completely isolated from auto-trade)
   */
  private async processTelegramBackgroundResult(uid: string, deepResearchResult: any, frequencyMinutes: number, accuracyTrigger: number): Promise<boolean> {
    const coin = deepResearchResult.symbol;
    const finalAccuracy = typeof deepResearchResult.accuracy === 'number'
      ? deepResearchResult.accuracy
      : parseFloat(deepResearchResult.accuracy as any) || 0;
    const finalAccuracyPercent = Math.round(finalAccuracy > 1 ? finalAccuracy : finalAccuracy * 100);
    const signal = deepResearchResult.signal || 'HOLD';

    // CRITICAL: TOP 25 COIN RESTRICTION - Block non-top-25 coins (single source of truth)
    try {
      const { getTop100Coins } = await import('./researchModes');
      const top25 = await getTop100Coins(uid, 25);
      const normalizedCoin = coin.toUpperCase();
      const isTop25 = top25.some(c => c.symbol === normalizedCoin);

      if (!isTop25) {
        logger.error({
          uid,
          coin: normalizedCoin,
          top25Symbols: top25.map(c => c.symbol)
        }, '❌ [TOP_25_BLOCK] Telegram alert blocked - symbol not in top 25');

        // Write history for top-25 blocked research
        try {
          await firestoreAdapter.storeResearchHistory(uid, {
            symbol: normalizedCoin,
            signal: signal || 'HOLD',
            accuracy: finalAccuracyPercent,
            price: 0,
            tradePlan: null,
            isDeepResearch: true,
            source: 'TELEGRAM_BACKGROUND',
            status: 'SKIPPED',
            skipReason: 'Symbol not in top 25 high-liquidity coins'
          });
        } catch (histError: any) {
          logger.warn({ uid, coin: normalizedCoin, error: histError.message }, 'Failed to store top-25 block history');
        }
        return;
      }
    } catch (top25CheckError: any) {
      logger.error({ uid, coin, error: top25CheckError.message }, '❌ [TOP_25_ERROR] Error checking top 25');
      return;
    }

    // WHALE ALERT: Check for large moves independently
    try {
      const userSettings = await firestoreAdapter.getSettings(uid);
      if (userSettings?.notifications?.whaleAlerts) {
        await autoTradeEngine.checkWhaleAlerts(uid, coin);
      }
    } catch (whaleErr) {
      // Silent failure for whale alerts
    }

    // Accuracy trigger evaluation
    const minTrigger = typeof accuracyTrigger === 'number' ? accuracyTrigger : 80;
    const isInRange = finalAccuracyPercent >= minTrigger;

    // Send Telegram alert if qualified
    if (isInRange) {
      await this.sendTelegramBackgroundAlert(uid, coin, signal, finalAccuracyPercent, accuracyTrigger);
    }

    // Write history
    try {
      await firestoreAdapter.storeResearchHistory(uid, {
        symbol: coin,
        signal: signal || 'HOLD',
        accuracy: finalAccuracyPercent,
        price: 0,
        tradePlan: null,
        isDeepResearch: true,
        source: 'TELEGRAM_BACKGROUND',
        status: 'EXECUTED'
      });
    } catch (histError: any) {
      logger.warn({ uid, coin, error: histError.message }, 'Failed to store Telegram background history');
    }

    return true; // Successfully processed
  }

  /**
   * Send Telegram background alert (completely isolated from auto-trade)
   */
  private async sendTelegramBackgroundAlert(uid: string, coin: string, signal: string, accuracy: number, trigger: number): Promise<void> {
    try {
      const settings = await firestoreAdapter.getBackgroundResearchSettings(uid);
      const hasBotToken = !!settings?.telegramBotToken;
      const hasChatId = !!settings?.telegramChatId;

      if (!hasBotToken || !hasChatId) {
        logger.debug({ uid }, '⏭️ [TELEGRAM] Missing bot token or chat ID');
        return;
      }

      // Send alert via telegramService
      const message = `🚨 DLXTRADE Background Research Alert\n\nCoin: ${coin}\nSignal: ${signal}\nAccuracy: ${accuracy}%\nTrigger: ${trigger}%`;
      const result = await telegramService.sendMessage(settings.telegramBotToken, settings.telegramChatId, message);

      if (result.success) {
        logger.info({ uid, coin, accuracy }, '✅ [TELEGRAM] Background alert sent');
      } else {
        logger.warn({ uid, coin, error: result.error }, '❌ [TELEGRAM] Alert failed');
      }
    } catch (error: any) {
      logger.warn({ uid, coin, error: error.message }, '❌ [TELEGRAM] Alert error');
    }
  }

  /**
   * Check if UID is a system/internal UID that should be skipped
   */
  private isSystemUid(uid: string): boolean {
    if (!uid) return true;
    if (uid === '_init') return true;
    if (uid.startsWith('_')) return true;
    return false;
  }

  /**
   * Check if user has usable market data providers
   * CRITICAL: Background research requires at least one market data provider
   */
  private async hasUsableMarketDataProviders(uid: string): Promise<boolean> {
    try {
      const providerConfig = await getUserIntegrationsByUid(uid, 'background_job');
      const marketDataKeys = Object.keys(providerConfig?.marketData || {});

      // Check if any market data provider is enabled
      const hasEnabledProvider = marketDataKeys.some(key => {
        const provider = providerConfig.marketData[key];
        return provider?.enabled === true;
      });

      if (marketDataKeys.length === 0 || !hasEnabledProvider) {
        return false;
      }

      return true;
    } catch (error: any) {
      logger.error({
        uid,
        error: error.message
      }, '❌ [SCHEDULER] Error checking market data providers');
      // On error, assume no providers to be safe
      return false;
    }
  }

  /**
   * Check if user has required primary APIs for Telegram Background Research
   * REQUIRES: CryptoCompare AND at least ONE enabled news provider with valid apiKey
   * (CryptoPanic, GNews, Reddit, MarketAux, NewsData, etc.)
   */
  private async hasRequiredPrimaryAPIs(uid: string): Promise<boolean> {
    try {
      const providerConfig = await getUserIntegrationsByUid(uid, 'background_job');
      const cryptocompare = providerConfig?.marketData?.cryptocompare;

      const hasCryptoCompare = cryptocompare?.enabled === true && !!cryptocompare?.apiKey;

      // Check for ANY valid news provider (not just NewsData)
      // A provider is VALID only if: enabled === true AND apiKey exists AND apiKey is non-empty string
      const hasValidNewsProvider = providerConfig?.news &&
        Object.values(providerConfig.news).some((p: any) =>
          p?.enabled === true && p?.apiKey && typeof p.apiKey === 'string' && p.apiKey.trim().length > 0
        );

      return hasCryptoCompare && hasValidNewsProvider;
    } catch (error: any) {
      logger.error({
        uid,
        error: error.message
      }, '❌ [SCHEDULER] Error checking required primary APIs');
      return false;
    }
  }

  /**
   * Check if user has usable exchange APIs for Auto-Trade Research
   * REQUIRES: At least one exchange adapter (Binance, Bitget, BingX, WEEX)
   */
  private async hasUsableExchangeAPIs(uid: string): Promise<boolean> {
    try {
      // CRITICAL: Exchange is usable if encrypted keys exist - NEVER use decryption to determine usability
      // This check determines if auto-trade can execute, based on Firestore presence only
      const { isExchangeUsable } = await import('./firestoreAdapter');
      const result = await isExchangeUsable(uid);
      return result.usable;
    } catch (error: any) {
      // Log error but return false - this should not happen with pure Firestore checks
      logger.warn({
        uid,
        error: error.message
      }, 'Error checking exchange usability');
      return false;
    }
  }

}

export const backgroundResearchScheduler = new BackgroundResearchScheduler();
