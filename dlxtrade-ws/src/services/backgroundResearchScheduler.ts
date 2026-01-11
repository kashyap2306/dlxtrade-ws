import { logger } from "../utils/logger";
import { firestoreAdapter } from "./firestoreAdapter";
import { runFreeModeDeepResearch } from "./deepResearchEngine";
import { telegramService } from "./telegramService";
import { autoTradeEngine } from "./autoTradeEngine";
import { getFirebaseAdmin } from "../utils/firebase";
import { getUserIntegrationsByUid } from "../routes/users/providerConfig";
import * as admin from "firebase-admin";
import { checkWhaleAlerts } from "./autoTradeTelegram";
import {
  safeSetInterval,
  shouldRunBackgroundTasks,
  withTimeout,
  yieldToEventLoop,
  safeExternalCall,
  runBackgroundTask,
} from "../utils/safeBackgroundRunner";

interface UserJobState {
  isRunning: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  mode?: "TELEGRAM_BACKGROUND_RESEARCH" | "AUTO_TRADE_RESEARCH";
}

// Research modes
const RESEARCH_MODE = {
  TELEGRAM_BACKGROUND_RESEARCH: "TELEGRAM_BACKGROUND_RESEARCH",
  AUTO_TRADE_RESEARCH: "AUTO_TRADE_RESEARCH",
} as const;

export class BackgroundResearchScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private userIntervals: Map<string, NodeJS.Timeout> = new Map();
  private userJobStates: Map<string, UserJobState> = new Map();
  private readonly COOLDOWN_MINUTES = 1; // Minimum minutes between alerts for same coin
  // CRITICAL: Track decryption failures per user to prevent retry loops
  // Maps uid -> { lastFailureTime, failureCount, disabled }
  private decryptionFailureCache: Map<
    string,
    { lastFailureTime: Date; failureCount: number; disabled: boolean }
  > = new Map();
  // Track users in soft-skip state to prevent thrashing
  private softSkipUsers = new Map<string, { until: number; reason: string }>();
  // Lock mechanism to prevent race conditions in user operations
  private userOperationLocks = new Map<string, { until: number }>();
  // Lock to prevent parallel execution of updateUserResearchSchedule() for same uid
  private activeScheduleLocks = new Map<string, boolean>();

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
    console.log(
      "🔥 [HARD_LOG] [SCHEDULER_START] Background research scheduler start() called",
    );
    logger.info(
      { timestamp: new Date().toISOString() },
      "🔥 [HARD_LOG] [SCHEDULER_START] Background research scheduler start() called",
    );

    // Check env flag first
    if (process.env.DISABLE_AUTOTRADE === "true") {
      logger.warn("Background research scheduler DISABLED by env flag");
      console.log(
        "🛑 [AUTO-TRADE LOOP] Background research scheduler DISABLED by DISABLE_AUTOTRADE=true",
      );
      console.log(
        "🛑 [AUTO-TRADE LOOP] Auto-trade execution loop will NOT run",
      );
      console.log(
        "🔥 [HARD_LOG] [SCHEDULER_BLOCKED] Scheduler blocked by DISABLE_AUTOTRADE=true",
      );
      return;
    }

    if (this.isRunning) {
      logger.warn("Background research scheduler is already running");
      console.log(
        "[AUTO-TRADE LOOP] Scheduler already running, skipping start",
      );
      console.log(
        "🔥 [HARD_LOG] [SCHEDULER_ALREADY_RUNNING] Scheduler already running, skipping start",
      );
      return;
    }
    this.isRunning = true;
    console.log(
      "🔥 [HARD_LOG] [SCHEDULER_RUNNING] Scheduler isRunning set to true",
    );
    logger.info(
      {
        schedulerRunning: this.isRunning,
        schedulerImmortal: true,
        checkIntervalSeconds: 60,
        willRunContinuously: true,
      },
      "✅ [SCHEDULER_IMMORTAL] Background research scheduler started - SERVER-SIDE ONLY (independent of frontend) - IMMORTAL MODE",
    );
    console.log(
      "[AUTO-TRADE LOOP] ✅ Background research scheduler started - execution loop is ACTIVE - IMMORTAL MODE",
    );
    console.log(
      "[AUTO-TRADE LOOP]    - Runs server-side independently of frontend",
    );
    console.log(
      "[AUTO-TRADE LOOP]    - Survives user logout, tab close, browser shutdown",
    );
    console.log(
      "[AUTO-TRADE LOOP]    - NO frontend dependencies (WebSocket, polling, or UI presence)",
    );
    console.log(
      "[AUTO-TRADE LOOP]    - IMMORTAL: Will run continuously until manually disabled",
    );

    // Bootstrap: Load all enabled users immediately on startup (non-blocking)
    console.log(
      "🔥 [HARD_LOG] [BOOTSTRAP_START] Starting bootstrapEnabledUsers()",
    );
    runBackgroundTask(
      () => this.bootstrapEnabledUsers(),
      "scheduler-bootstrap",
      30000, // 30s timeout for bootstrap
    ).catch((err: any) => {
      logger.error(
        { error: err?.message },
        "❌ [SCHEDULER] Bootstrap failed, continuing with periodic checks",
      );
      console.log(
        "🔥 [HARD_LOG] [BOOTSTRAP_ERROR] Bootstrap failed:",
        err?.message,
      );
    });

    // Check for users with enabled background research every minute
    // REFACTORED: Use safeSetInterval for event loop protection
    // CRITICAL: This runs server-side, independent of frontend
    // CRITICAL: This interval is IMMORTAL - it will continuously check and reschedule users
    console.log(
      "🔥 [HARD_LOG] [INTERVAL_CREATE] Creating main scheduler interval (60s)",
    );
    this.intervalId = safeSetInterval(
      async () => {
        console.log(
          "🔥 [HARD_LOG] [INTERVAL_TICK] Main scheduler interval tick - checking users",
        );
        logger.debug(
          {
            schedulerRunning: this.isRunning,
            activeUserIntervals: this.userIntervals.size,
            activeJobStates: this.userJobStates.size,
          },
          "🔄 [SCHEDULER_IMMORTAL] Periodic check cycle starting - verifying all enabled users are scheduled",
        );
        await this.checkAndScheduleUserResearchSafe();
      },
      60 * 1000,
      "scheduler-check-users",
    );
    console.log(
      "🔥 [HARD_LOG] [INTERVAL_CREATED] Main scheduler interval created, intervalId:",
      !!this.intervalId,
    );

    logger.info(
      {
        intervalId: this.intervalId ? "created" : "null",
        checkIntervalMs: 60000,
        schedulerImmortal: true,
      },
      "✅ [SCHEDULER_IMMORTAL] Main scheduler interval created - will run continuously every 60 seconds",
    );

    // 🔥 DEBUG: Log scheduler startup confirmation
    logger.info(
      {
        schedulerRunning: this.isRunning,
        intervalId: !!this.intervalId,
        serverSide: true,
        frontendIndependent: true,
      },
      "🔍 [SCHEDULER_LIFECYCLE_DEBUG] Background Research Scheduler started - server-side only",
    );
  }

  /**
   * Safe wrapper for checkAndScheduleUserResearch
   */
  private async checkAndScheduleUserResearchSafe(): Promise<void> {
    console.log(
      "🔥 [HARD_LOG] [CHECK_START] checkAndScheduleUserResearchSafe() called",
    );
    if (!shouldRunBackgroundTasks()) {
      logger.debug("Skipping user research check - background tasks paused");
      console.log(
        "🔥 [HARD_LOG] [CHECK_BLOCKED] Background tasks paused, skipping check",
      );
      return;
    }

    try {
      console.log(
        "⏰ [SCHEDULER_HEARTBEAT] Research Scheduler Active - Checking users...",
      );
      console.log(
        "🔥 [HARD_LOG] [CHECK_EXECUTING] Calling checkAndScheduleUserResearch()",
      );
      await withTimeout(
        () => this.checkAndScheduleUserResearch(),
        10000, // 10s timeout
        "check-schedule-users",
      );
      console.log(
        "🔥 [HARD_LOG] [CHECK_COMPLETE] checkAndScheduleUserResearch() completed",
      );
    } catch (err: any) {
      logger.warn({ error: err.message }, "User research check timed out");
      console.log(
        "🔥 [HARD_LOG] [CHECK_ERROR] checkAndScheduleUserResearch() error:",
        err?.message,
      );
    }
  }

  /**
   * Bootstrap: Load ALL users with backgroundResearchEnabled === true on server start
   * CRITICAL: This ensures scheduler survives server restarts
   */
  private async bootstrapEnabledUsers() {
    try {
      logger.info("🔄 [SCHEDULER] Bootstrapping enabled users on startup...");

      const db = getFirebaseAdmin().firestore();
      const usersSnapshot = await db.collection("users").get();

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
            logger.info(
              { uid },
              "⏭️ [SCHEDULER] Skipping system UID for background research",
            );
            continue;
          }

          // Check both auto-trade and Telegram background research
          const autoTradeConfigDoc = await db
            .collection("users")
            .doc(uid)
            .collection("autoTradeConfig")
            .doc("current")
            .get();
          const autoTradeConfig = autoTradeConfigDoc.exists
            ? autoTradeConfigDoc.data()
            : null;
          const autoTradeEnabled = autoTradeConfig?.autoTradeEnabled === true;

          const settings =
            await firestoreAdapter.getBackgroundResearchSettings(uid);
          // Check explicit telegramBackgroundResearchEnabled flag
          const telegramBgResearchEnabled =
            settings?.telegramBackgroundResearchEnabled === true ||
            (settings?.backgroundResearchEnabled === true &&
              settings?.telegramBackgroundResearchEnabled !== false);

          // Bootstrap if either mode is enabled
          if (autoTradeEnabled || telegramBgResearchEnabled) {
            enabledCount++;
            logger.info(
              { uid, autoTradeEnabled, telegramBgResearchEnabled },
              "📋 [SCHEDULER] Found enabled user during bootstrap",
            );

            // CRITICAL: Use ensureUserResearchScheduled for hard guarantee during bootstrap
            const scheduleResult = await this.ensureUserResearchScheduled(uid);
            if (scheduleResult.scheduled) {
              registeredCount++;
              logger.info(
                { uid },
                "✅ [SCHEDULER] User registered during bootstrap",
              );
            } else {
              logger.warn(
                { uid, reason: scheduleResult.reason },
                "⚠️ [SCHEDULER] User registration failed during bootstrap",
              );
            }
          }
        } catch (userErr: any) {
          logger.warn(
            { uid, error: userErr.message },
            "⚠️ [SCHEDULER] Error checking user during bootstrap, skipping",
          );
        }
      }

      logger.info(
        {
          totalUsers: usersSnapshot.docs.length,
          enabledUsers: enabledCount,
          registeredUsers: registeredCount,
        },
        "✅ [SCHEDULER] Bootstrap completed - enabled users registered",
      );
    } catch (error: any) {
      logger.error(
        { error: error.message, stack: error.stack },
        "❌ [SCHEDULER] Error during bootstrap",
      );
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
      logger.debug({ uid }, "User research interval cleared");
    }
    this.userIntervals.clear();
    this.userJobStates.clear();

    this.isRunning = false;
    logger.info("⏹️ [SCHEDULER] Background research scheduler stopped");
  }

  /**
   * Check all users and schedule/cancel their research intervals as needed
   */
  private async checkAndScheduleUserResearch() {
    try {
      console.log(
        "🔥 [HARD_LOG] [CHECK_USERS_START] checkAndScheduleUserResearch() - fetching users from Firestore",
      );
      logger.debug(
        {
          schedulerRunning: this.isRunning,
          activeIntervals: this.userIntervals.size,
          activeJobStates: this.userJobStates.size,
        },
        "🔍 [SCHEDULER_IMMORTAL] Checking users for background research scheduling - ensuring all enabled users are scheduled",
      );

      const db = getFirebaseAdmin().firestore();
      const usersSnapshot = await db.collection("users").get();
      console.log(
        "🔥 [HARD_LOG] [CHECK_USERS_FETCHED] Fetched",
        usersSnapshot.docs.length,
        "users from Firestore",
      );

      logger.info(
        {
          userCount: usersSnapshot.docs.length,
          activeIntervalsBefore: this.userIntervals.size,
        },
        "📊 [SCHEDULER_IMMORTAL] Checking users for background research - verifying scheduler continuity",
      );

      let scheduledCount = 0;
      let skippedCount = 0;

      // Process users in small batches to prevent event loop blocking
      const BATCH_SIZE = 3;
      const userDocs = usersSnapshot.docs;

      for (let i = 0; i < userDocs.length; i += BATCH_SIZE) {
        const batch = userDocs.slice(i, i + BATCH_SIZE);
        console.log(
          `🔥 [HARD_LOG] [BATCH_PROCESS] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(userDocs.length / BATCH_SIZE)} (${batch.length} users)`,
        );

        // Process each user in the batch
        for (const userDoc of batch) {
          const uid = userDoc.id;
          console.log("🔥 [HARD_LOG] [USER_CHECK] Processing user:", uid);

          // CRITICAL: Skip system/internal UIDs
          if (this.isSystemUid(uid)) {
            console.log("🔥 [HARD_LOG] [USER_SKIP] Skipping system UID:", uid);
            continue;
          }

          const wasScheduled = this.userIntervals.has(uid);
          // Check if user is in soft-skip cooldown
          const softSkipInfo = this.softSkipUsers.get(uid);
          const now = Date.now();

          if (softSkipInfo && softSkipInfo.until > now) {
            // User in soft-skip cooldown - skip rescheduling attempt
            console.log(
              "🔥 [HARD_LOG] [SOFT_SKIP_COOLDOWN] Skipping reschedule attempt for user in cooldown:",
              uid,
              "reason:",
              softSkipInfo.reason,
              "remaining:",
              Math.round((softSkipInfo.until - now) / 1000) + "s",
            );
            continue;
          }

          // Clear expired soft-skip
          if (softSkipInfo && softSkipInfo.until <= now) {
            this.softSkipUsers.delete(uid);
          }

          // CRITICAL: Determine FINAL MODE ONCE per user per cycle
          // This prevents multiple mode evaluations for the same UID
          let finalMode: "TELEGRAM_BACKGROUND_RESEARCH" | "AUTO_TRADE_RESEARCH" | null = null;
          let finalFrequency: number | null = null;
          let shouldSkipUser = false;

          try {
            // Determine mode and frequency for this user (MOVED FROM updateUserResearchSchedule)
            const db = getFirebaseAdmin().firestore();

            // Check Auto Trade config first (highest priority)
            const autoTradeConfigDoc = await db
              .collection("users")
              .doc(uid)
              .collection("autoTradeConfig")
              .doc("current")
              .get();
            const autoTradeConfig = autoTradeConfigDoc.exists
              ? autoTradeConfigDoc.data()
              : null;
            const autoTradeEnabled = autoTradeConfig?.autoTradeEnabled === true;

            // Read background research settings
            const settings =
              await firestoreAdapter.getBackgroundResearchSettings(uid);
            const telegramBgResearchEnabled =
              settings?.telegramBackgroundResearchEnabled === true ||
              (settings?.backgroundResearchEnabled === true &&
                settings?.telegramBackgroundResearchEnabled !== false);

            // EARLY RETURN: Skip users with both modes disabled
            if (!autoTradeEnabled && !telegramBgResearchEnabled) {
              console.log(
                "🔥 [HARD_LOG] [EARLY_RETURN] Both modes disabled for user:",
                uid,
                "- skipping user in this cycle",
              );
              continue; // Skip this user entirely
            }

            // CONFLICT RESOLUTION: Auto-Trade always wins for execution mode
            if (autoTradeEnabled) {
              finalMode = "AUTO_TRADE_RESEARCH";
              finalFrequency = settings?.researchFrequencyMinutes || 5;

              // CRITICAL: Exchange status validation for AUTO_TRADE mode
              const exchangeStatus = await this.hasUsableExchangeAPIs(uid);
              if (exchangeStatus.reason === "not_connected") {
                // SOFT SKIP: Add to cooldown but don't stop scheduler
                console.log("🔥 [HARD_LOG] [AUTO_TRADE_SOFT_SKIP_IN_CHECK]", {
                  uid,
                  reason: "exchange_not_connected",
                  mode: "AUTO_TRADE_RESEARCH_SOFT_SKIP",
                });
                this.softSkipUsers.set(uid, {
                  until: Date.now() + 120000, // 2 minutes
                  reason: "not_connected",
                });
                shouldSkipUser = true;
              } else if (exchangeStatus.reason === "disconnected") {
                // HARD STOP: Force stop scheduler
                console.log(
                  "🔥 [HARD_LOG] [AUTO_TRADE_HARD_STOP_IN_CHECK]",
                  {
                    uid,
                    reason: "exchange_hard_stop_" + exchangeStatus.reason,
                    mode: "AUTO_TRADE_RESEARCH_BLOCKED",
                  },
                );
                await this.forceStopUserScheduler(uid, exchangeStatus.reason);
                shouldSkipUser = true;
              }
            } else if (telegramBgResearchEnabled) {
              finalMode = "TELEGRAM_BACKGROUND_RESEARCH";
              finalFrequency = settings?.researchFrequencyMinutes || 5;
            }

            if (shouldSkipUser) {
              continue; // Skip this user due to exchange status
            }

            console.log(
              "🔥 [HARD_LOG] [USER_SCHEDULE_START] Determined final mode for user:",
              uid,
              "mode:",
              finalMode,
              "frequency:",
              finalFrequency,
              "wasScheduled:",
              wasScheduled,
            );
          } catch (modeError: any) {
            console.log(
              "🔥 [HARD_LOG] [MODE_DETERMINATION_FAILED] Failed to determine mode for user:",
              uid,
              "error:",
              modeError.message,
            );
            continue; // Skip this user if we can't determine mode
          }

          try {
            await this.withUserLock(uid, () =>
              this.updateUserResearchSchedule(uid, true, finalMode, finalFrequency),
            );
          } catch (error) {
            if (error.message === "USER_OPERATION_LOCKED") {
              logger.info(
                { uid },
                "⏱️ [SCHEDULER] Skipping schedule update due to concurrent operation",
              );
              continue; // Skip this user and move to next
            }
            // Let other errors propagate to outer catch
            throw error;
          }

          const isScheduled = this.userIntervals.has(uid);
          console.log(
            "🔥 [HARD_LOG] [USER_SCHEDULE_COMPLETE] updateUserResearchSchedule() completed for:",
            uid,
            "isScheduled:",
            isScheduled,
          );

          if (isScheduled && !wasScheduled) {
            scheduledCount++;
            logger.info(
              { uid },
              "✅ [SCHEDULER_IMMORTAL] User scheduled/re-scheduled - interval created",
            );
          } else if (isScheduled && wasScheduled) {
            // Already scheduled - verified
          } else if (!isScheduled) {
            skippedCount++;
          }
        }

        // Yield to event loop between batches to prevent blocking
        if (i + BATCH_SIZE < userDocs.length) {
          console.log(
            "🔥 [HARD_LOG] [BATCH_YIELD] Yielding to event loop between batches",
          );
          await yieldToEventLoop();
        }
      }

      logger.info(
        {
          totalUsers: usersSnapshot.docs.length,
          scheduledCount,
          skippedCount,
          activeIntervalsAfter: this.userIntervals.size,
          schedulerContinues: true,
        },
        "✅ [SCHEDULER_IMMORTAL] Check cycle complete - scheduler verified, will continue running",
      );
    } catch (error: any) {
      // CRITICAL: Errors in checkAndScheduleUserResearch should NOT stop the scheduler
      // The interval will continue and retry on next cycle
      logger.error(
        {
          error: error.message,
          stack: error.stack,
          schedulerContinues: true,
          willRetry: true,
        },
        "❌ [SCHEDULER_IMMORTAL] Error checking user research schedules - scheduler continues, will retry on next cycle",
      );
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
  private async updateUserResearchSchedule(uid: string, preValidated: boolean = false, preDeterminedMode?: string, preDeterminedFrequency?: number) {
    // FIRST GUARD: Prevent parallel execution for same uid
    if (this.activeScheduleLocks.get(uid) === true) {
      console.log(
        "🔥 [HARD_LOG] [SCHEDULER_LOCK_SKIP] Skipping parallel updateUserResearchSchedule for uid:",
        uid,
        "- already executing"
      );
      logger.info(
        { uid, operation: "parallel_execution_blocked" },
        "[SCHEDULER_LOCK_SKIP] Parallel updateUserResearchSchedule blocked"
      );
      return;
    }

    // Set lock for this execution
    this.activeScheduleLocks.set(uid, true);

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
      const autoTradeConfigDoc = await db
        .collection("users")
        .doc(uid)
        .collection("autoTradeConfig")
        .doc("current")
        .get();
      const autoTradeConfig = autoTradeConfigDoc.exists
        ? autoTradeConfigDoc.data()
        : null;
      const autoTradeEnabled = autoTradeConfig?.autoTradeEnabled === true;

      // Read background research settings
      const settings =
        await firestoreAdapter.getBackgroundResearchSettings(uid);
      // CRITICAL: Check explicit telegramBackgroundResearchEnabled flag first
      // This flag is set when user completes Telegram setup and starts Deep Research
      const telegramBgResearchEnabled =
        settings?.telegramBackgroundResearchEnabled === true ||
        (settings?.backgroundResearchEnabled === true &&
          settings?.telegramBackgroundResearchEnabled !== false);

      // CRITICAL: If pre-validated, skip all mode determination and use provided values
      let mode: "TELEGRAM_BACKGROUND_RESEARCH" | "AUTO_TRADE_RESEARCH" | null = null;
      let shouldSchedule = false;
      let finalFrequency: number | null = null;

      if (preValidated && preDeterminedMode && preDeterminedFrequency) {
        // Use pre-determined and pre-validated values from checkAndScheduleUserResearch
        mode = preDeterminedMode as "TELEGRAM_BACKGROUND_RESEARCH" | "AUTO_TRADE_RESEARCH";
        finalFrequency = preDeterminedFrequency;
        shouldSchedule = true;
        console.log(
          "🔥 [HARD_LOG] [MODE_PRE_VALIDATED] Using pre-validated mode for user:",
          uid,
          "mode:",
          mode,
          "frequency:",
          finalFrequency,
        );
      } else {
        // FALLBACK: Original mode determination logic (for other callers like onUserSettingsChanged)
        console.log(
          "🔥 [HARD_LOG] [MODE_FALLBACK] Using fallback mode determination for user:",
          uid,
          "- this should be rare",
        );

        // EARLY RETURN: Skip users with both modes disabled
        if (!autoTradeEnabled && !telegramBgResearchEnabled) {
          console.log(
            "🔥 [HARD_LOG] [EARLY_RETURN] Both modes disabled for user:",
            uid,
            "- skipping all processing",
          );
          // Remove any existing interval for this user
          if (this.userIntervals.has(uid)) {
            clearInterval(this.userIntervals.get(uid)!);
            this.userIntervals.delete(uid);
            this.userJobStates.delete(uid);
            console.log(
              "🔥 [HARD_LOG] [INTERVAL_CLEANUP] Removed interval for disabled user:",
              uid,
            );
          }
          return;
        }

        // CONFLICT RESOLUTION: Auto-Trade always wins for execution mode
        // CRITICAL: When Auto-Trade is enabled, Telegram Background Research is COMPLETELY BYPASSED
        // Telegram alerts are sent FROM Auto-Trade engine, not from separate Telegram engine

        console.log(
          "🔥 [HARD_LOG] [MODE_CHECK] Checking mode for user:",
          uid,
          "autoTradeEnabled:",
          autoTradeEnabled,
          "telegramBgResearchEnabled:",
          telegramBgResearchEnabled,
        );

        if (autoTradeEnabled) {
          // AUTO_TRADE_RESEARCH mode - HIGHEST PRIORITY
          // CRITICAL: Telegram Background Research engine is COMPLETELY BYPASSED when Auto-Trade is enabled
          mode = RESEARCH_MODE.AUTO_TRADE_RESEARCH;
          // CRITICAL: Frequency MUST come from Auto-Trade settings, NOT Telegram settings
          // When Auto-Trade is enabled, Telegram frequency is IGNORED
          finalFrequency = settings?.researchFrequencyMinutes || 5;
          shouldSchedule = true;
          console.log(
            "🔥 [HARD_LOG] [MODE_SELECTED] AUTO_TRADE_RESEARCH mode selected, frequency:",
            finalFrequency,
            "shouldSchedule:",
            shouldSchedule,
          );

          // HARD LOG: Mode priority enforcement
          logger.info(
            {
              uid,
              autoTradeEnabled: true,
              telegramBgResearchEnabled,
              selectedMode: "AUTO_TRADE_RESEARCH",
              telegramModeBypassed: true,
              frequencySource: "AUTO_TRADE",
              frequencyMinutes: finalFrequency,
              telegramFrequencyIgnored: true,
            },
            "🎯 [MODE_PRIORITY] Auto-Trade ENABLED → AUTO_TRADE_RESEARCH mode selected, Telegram Background Research BYPASSED",
          );

          // CRITICAL: Exchange disconnection MUST block AUTO_TRADE_RESEARCH mode
          // Scheduler should NOT run when exchange is explicitly disconnected
          const exchangeStatus = await this.hasUsableExchangeAPIs(uid);

          // MANDATORY RULES: Handle exchange status based on reason
          // STRICT INVARIANT:
          // 1. not_connected → SOFT SKIP ONLY
          if (exchangeStatus.reason === "not_connected") {
            // SOFT SKIP: Exchange not usable - DO NOT stop scheduler
            console.log("🔥 [HARD_LOG] [AUTO_TRADE_SOFT_SKIP]", {
              uid,
              reason: "exchange_not_connected",
              mode: "AUTO_TRADE_RESEARCH_SOFT_SKIP",
            });

            logger.warn(
              { uid },
              "[SCHEDULER_SOFT_SKIP] exchange not_connected – skipping without stopping",
            );

            // Add to soft-skip cooldown - 2 minute cooldown to avoid thrashing
            this.softSkipUsers.set(uid, {
              until: Date.now() + 120000, // 2 minutes
              reason: "not_connected",
            });

            // DO NOT call forceStopUserScheduler
            // DO NOT clear jobState
            // Just skip this cycle
            return null;
          } else if (exchangeStatus.reason === "disconnected") {
            console.log(
              "🔥 [HARD_LOG] [AUTO_TRADE_BLOCKED_EXCHANGE_DISCONNECTED]",
              {
                uid,
                reason: "exchange_hard_stop_" + exchangeStatus.reason,
                mode: "AUTO_TRADE_RESEARCH_BLOCKED",
              },
            );
            await this.forceStopUserScheduler(uid, exchangeStatus.reason);
            return;
          } else if (exchangeStatus.reason === "invalid_keys") {
            // Treat invalid keys as connected but will fail execution -> allow scheduling
            // Auto-trade engine will catch it and log event
          }

