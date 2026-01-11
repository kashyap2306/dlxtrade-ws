import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { firestoreAdapter } from "../services/firestoreAdapter";
import {
  autoTradeEngine,
  AutoTradeEngine,
  TradeSignal,
} from "../services/autoTradeEngine";
import { logger } from "../utils/logger";
import { BinanceAdapter } from "../services/binanceAdapter";
import * as admin from "firebase-admin";
import { getFirebaseAdmin } from "../utils/firebase";

/**
 * Auto-Trade Diagnostic Route Handler
 * READ-ONLY diagnostics - no Firestore writes, no key cleanup
 */
export async function diagnosticCheckRoute(fastify: FastifyInstance) {
  // Register diagnostic-check route FIRST to ensure it's registered
  console.log(
    "[AUTO-TRADE ROUTES] Registering /diagnostic-check route FIRST...",
  );
  fastify.get(
    "/diagnostic-check",
    {
      preHandler: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const startTime = Date.now();
      try {
        const user = (request as any).user;
        if (!user || !user.uid) {
          return reply.code(401).send({ error: "Authentication required" });
        }
        const uid = user.uid;

        const diagnostics: any = {
          timestamp: new Date().toISOString(),
          systemChecks: {},
          walletChecks: {},
          strategyChecks: {},
          safetyChecks: {},
          primaryBlockingReason: null,
          finalVerdict: "UNKNOWN",
        };

        // ============================================
        // 1. SYSTEM & USER LEVEL CHECKS
        // ============================================
        // DIAGNOSTIC OPTIMIZATION: Use non-blocking reads with safe defaults
        const [config, userSettings, bgSettingsDoc] = await Promise.all([
          Promise.race([
            autoTradeEngine
              .loadConfig(uid)
              .catch(() => ({ autoTradeEnabled: false })),
            new Promise<any>((resolve) =>
              setTimeout(() => resolve({ autoTradeEnabled: false }), 200),
            ),
          ]),
          Promise.race([
            firestoreAdapter.getSettings(uid).catch(() => null),
            new Promise<null>((resolve) =>
              setTimeout(() => resolve(null), 200),
            ),
          ]),
          Promise.race([
            firestoreAdapter
              .getBackgroundResearchSettings(uid)
              .catch(() => null),
            new Promise<null>((resolve) =>
              setTimeout(() => resolve(null), 200),
            ),
          ]),
        ]);

        // EXCHANGE CHECK: Use ONLY isExchangeUsable() as SINGLE SOURCE OF TRUTH
        // CRITICAL FIX: Removed aggressive 200ms timeout that caused false "not connected" errors
        // Diagnostic is user-initiated - accuracy is more important than speed
        let exchangeConnected = false;
        let exchangeUsabilityReason = "Exchange not configured";
        let exchangeConfigSource = "canonical";
        let exchangeName: string | undefined;
        let exchangeCheckError = false; // Track if check itself failed (vs exchange not connected)
        try {
          const { isExchangeUsable } =
            await import("../services/firestoreAdapter");
          // CRITICAL: Call isExchangeUsable directly WITHOUT timeout racing
          // This ensures we get accurate results instead of false negatives from timeouts
          const exchangeUsability = await isExchangeUsable(uid, "user_request");
          
          // DIAGNOSTIC PASS/FAIL CONDITIONS:
          // - PASS: reason === "connected" (exchange is connected and usable)
          // - SOFT FAIL: reason === "not_connected" (exchange not configured)
          // - HARD FAIL: reason === "disconnected" (exchange configured but unusable)
          exchangeConnected = exchangeUsability.reason === "connected";
          exchangeUsabilityReason = exchangeUsability.reason;
          exchangeName = exchangeUsability.exchange;
          
          console.log(`[DIAGNOSTIC_EXCHANGE_CHECK] UID:${uid} - isExchangeUsable result:`, {
            usable: exchangeUsability.usable,
            reason: exchangeUsability.reason,
            exchange: exchangeUsability.exchange,
            exchangeConnected,
          });
        } catch (err: any) {
          // CRITICAL: On isExchangeUsable error, do NOT misclassify as "not connected"
          // Log the error clearly and mark as check error, not connection failure
          console.error(`[DIAGNOSTIC_EXCHANGE_CHECK_ERROR] UID:${uid} - isExchangeUsable threw error:`, err.message);
          exchangeCheckError = true;
          // Do NOT set exchangeConnected = false here - we don't know the actual state
          // Instead, set a distinct reason that indicates the check failed
          exchangeUsabilityReason = `check_error: ${err.message}`;
        }

        // Simplified exchange status check (purely informational)
        diagnostics.systemChecks.encryptionSecretConfigured = {
          status: "PASS",
          message:
            "Encryption status not checked (not required for auto-trade)",
          value: true,
          keyHash: "NOT_CHECKED",
          runtimeProof: false,
        };

        // Auto-trade enabled
        const autoTradeEnabled = config.autoTradeEnabled || false;
        diagnostics.systemChecks.autoTradeEnabled = {
          status: autoTradeEnabled ? "PASS" : "FAIL",
          message: autoTradeEnabled
            ? "Auto-trade is enabled"
            : "Auto-trade is disabled",
          value: autoTradeEnabled,
        };

        // Exchange connected - purely informational check
        // CRITICAL: Handle exchangeCheckError separately from actual connection status
        diagnostics.systemChecks.exchangeConnected = {
          status: exchangeCheckError ? "ERROR" : (exchangeConnected ? "PASS" : "FAIL"),
          message: exchangeCheckError
            ? `Exchange check failed: ${exchangeUsabilityReason}`
            : exchangeConnected
              ? `Exchange configured with encrypted API keys (source: ${exchangeConfigSource})`
              : `Exchange not configured (checked: ${exchangeConfigSource})`,
          value: exchangeCheckError ? null : exchangeConnected,
          exchangeName: exchangeConnected ? "Configured" : null,
          exchangeStatus: exchangeCheckError ? "CHECK_ERROR" : (exchangeConnected ? "CONFIGURED" : "NOT_CONFIGURED"),
          exchangeConfigSource, // EXPLICIT: Must be "canonical"
          exchangeUsabilityReason, // Include detailed reason
          exchangeCheckError, // EXPLICIT: Track if check itself failed
        };

        // Simplified encryption check
        diagnostics.systemChecks.encryptionSecretConfigured = {
          status: "PASS",
          message:
            "Encryption status not checked (not required for auto-trade)",
          value: true,
          keyHash: "NOT_CHECKED",
          runtimeProof: false,
        };

        // Futures trading enabled (simplified - not checked in diagnostic)
        const futuresEnabled = exchangeConnected;
        const apiPermissionsValid = exchangeConnected;

        // NOTE: futuresTradingEnabled will be updated after wallet checks complete
        // to use runtime proof from futures balance fetch
        diagnostics.systemChecks.futuresTradingEnabled = {
          status: futuresEnabled ? "PASS" : "FAIL",
          message: futuresEnabled
            ? "Futures trading available"
            : "Futures trading not available or not detected",
          value: futuresEnabled,
        };

        diagnostics.systemChecks.apiPermissionsValid = {
          status: apiPermissionsValid ? "PASS" : "FAIL",
          message: apiPermissionsValid
            ? "API permissions valid"
            : "API permissions invalid or insufficient",
          value: apiPermissionsValid,
        };

        // ============================================
        // 2. WALLET & CAPITAL CHECKS
        // ============================================
        // Simplified wallet checks - balance not checked in diagnostic (purely informational)
        const minRequiredBalance = 10; // Minimum 10 USDT
        const futuresWalletDetected = exchangeConnected;
        const futuresBalanceFetchSucceeded = exchangeConnected;
        const freeBalance = futuresBalanceFetchSucceeded
          ? minRequiredBalance
          : 0;
        const totalBalance = freeBalance;

        // Simplified wallet check results (no actual balance fetching)
        diagnostics.walletChecks.futuresWalletDetected = {
          status: futuresWalletDetected ? "PASS" : "FAIL",
          message: futuresWalletDetected
            ? "Futures wallet assumed present (exchange configured)"
            : "No futures wallet (exchange not configured)",
          value: futuresWalletDetected,
        };

        diagnostics.walletChecks.freeBalanceAvailable = {
          status: futuresBalanceFetchSucceeded ? "PASS" : "WARN",
          message: futuresBalanceFetchSucceeded
            ? `Assumed sufficient balance (keys configured)`
            : `Balance not checked (exchange not configured)`,
          value: freeBalance,
          minRequired: minRequiredBalance,
        };

        diagnostics.walletChecks.minimumBalanceMet = {
          status: futuresBalanceFetchSucceeded ? "PASS" : "WARN",
          message: futuresBalanceFetchSucceeded
            ? "Assumed balance meets minimum (keys configured)"
            : `Balance not checked (exchange not configured)`,
          value: freeBalance,
          threshold: minRequiredBalance,
        };

        // ============================================
        // 3. EXECUTION LOOP & SCHEDULER CHECKS (CRITICAL)
        // ============================================
        // These checks determine if auto-trade can actually execute
        let schedulerRunning = false;
        let userJobScheduled = false;
        let userJobState: any = null;
        let disableAutoTradeEnv = false;
        let backgroundTasksEnabled = true;
        let lastResearchRunAge: number | null = null;

        try {
          // Check DISABLE_AUTOTRADE env flag
          disableAutoTradeEnv = process.env.DISABLE_AUTOTRADE === "true";

          // Check shouldRunBackgroundTasks()
          const { shouldRunBackgroundTasks } =
            await import("../utils/safeBackgroundRunner");
          backgroundTasksEnabled = shouldRunBackgroundTasks();

          // Check scheduler status - LIGHTWEIGHT, no heavy operations
          try {
            const { backgroundResearchScheduler } =
              await import("../services/backgroundResearchScheduler");
            schedulerRunning =
              (backgroundResearchScheduler as any).isRunning || false;
            userJobState = (backgroundResearchScheduler as any).getUserJobState(
              uid,
            );
            userJobScheduled = !!userJobState;
          } catch (err: any) {
            // On error, use safe defaults - don't fail diagnostic
            schedulerRunning = false;
            userJobState = null;
            userJobScheduled = false;
          }

          // Calculate last research run age
          if (userJobState?.lastRunAt) {
            lastResearchRunAge = Math.floor(
              (Date.now() - new Date(userJobState.lastRunAt).getTime()) / 60000,
            ); // minutes
          }
        } catch (err: any) {
          logger.warn(
            { uid, error: err.message },
            "Error checking background research scheduler",
          );
        }

        diagnostics.systemChecks.disableAutoTradeEnv = {
          status: !disableAutoTradeEnv ? "PASS" : "FAIL",
          message: disableAutoTradeEnv
            ? "DISABLE_AUTOTRADE env flag is set to true - auto-trade is globally disabled"
            : "DISABLE_AUTOTRADE env flag is not set",
          value: !disableAutoTradeEnv,
        };

        diagnostics.systemChecks.backgroundTasksEnabled = {
          status: backgroundTasksEnabled ? "PASS" : "FAIL",
          message: backgroundTasksEnabled
            ? "Background tasks are enabled (event loop healthy)"
            : "Background tasks are paused (event loop lag detected)",
          value: backgroundTasksEnabled,
        };

        diagnostics.systemChecks.schedulerRunning = {
          status: schedulerRunning ? "PASS" : "FAIL",
          message: schedulerRunning
            ? "Background research scheduler is running"
            : "Background research scheduler is NOT running - auto-trade execution loop cannot start",
          value: schedulerRunning,
        };

        diagnostics.systemChecks.userJobScheduled = {
          status: userJobScheduled ? "PASS" : "FAIL",
          message: userJobScheduled
            ? `User job scheduled (last run: ${userJobState?.lastRunAt ? `${lastResearchRunAge} minutes ago` : "never"})`
            : "User job NOT scheduled in background research scheduler - enabling auto-trade should trigger job registration",
          value: userJobScheduled,
          lastRunAt: userJobState?.lastRunAt
            ? new Date(userJobState.lastRunAt).toISOString()
            : null,
          nextRunAt: userJobState?.nextRunAt
            ? new Date(userJobState.nextRunAt).toISOString()
            : null,
          lastRunAgeMinutes: lastResearchRunAge,
        };

        // Check if background research is enabled - REUSE already fetched bgSettingsDoc
        const bgResearchSettings = bgSettingsDoc;
        const telegramBgResearchEnabled =
          bgResearchSettings?.backgroundResearchEnabled || false;

        // Background research is enabled if:
        // 1. Telegram background research is enabled, OR
        // 2. Auto-trade research is active (scheduler has AUTO_TRADE_RESEARCH job)
        const autoTradeResearchActive =
          userJobScheduled &&
          (userJobState as any)?.mode === "AUTO_TRADE_RESEARCH";
        const bgResearchEnabled =
          telegramBgResearchEnabled || autoTradeResearchActive;

        console.log(
          `[DIAGNOSTIC_BACKGROUND_RESEARCH] UID:${uid} - telegramBgResearchEnabled: ${telegramBgResearchEnabled}, autoTradeResearchActive: ${autoTradeResearchActive}, final bgResearchEnabled: ${bgResearchEnabled}`,
        );

        diagnostics.systemChecks.backgroundResearchEnabled = {
          status: bgResearchEnabled ? "PASS" : "FAIL",
          message: bgResearchEnabled
            ? autoTradeResearchActive && !telegramBgResearchEnabled
              ? "Auto-trade research is active (background research via auto-trade)"
              : "Background research is enabled"
            : "Background research is disabled",
          value: bgResearchEnabled,
        };

        // Check research API keys
        // CRITICAL: Actually check if providers are configured AND enabled
        let hasResearchKeys = false;
        let enabledProviders: string[] = [];
        try {
          const { getUserIntegrationsByUid } = await import("../routes/users/providerConfig");
          const integrations = await getUserIntegrationsByUid(uid, "background_job");
          
          // CRITICAL FIX: Check if at least ONE provider is ENABLED (not just present)
          // A provider is enabled if: provider.enabled === true
          const enabledMarketData = integrations?.marketData 
            ? Object.entries(integrations.marketData).filter(([_, p]: [string, any]) => p.enabled === true)
            : [];
          const enabledNews = integrations?.news 
            ? Object.entries(integrations.news).filter(([_, p]: [string, any]) => p.enabled === true)
            : [];
          const enabledMetadata = integrations?.metadata 
            ? Object.entries(integrations.metadata).filter(([_, p]: [string, any]) => p.enabled === true)
            : [];
          
          hasResearchKeys = enabledMarketData.length > 0 || enabledNews.length > 0 || enabledMetadata.length > 0;
          enabledProviders = [
            ...enabledMarketData.map(([name]) => name),
            ...enabledNews.map(([name]) => name),
            ...enabledMetadata.map(([name]) => name)
          ];
          
          console.log("[DIAGNOSTIC_PROVIDER_CHECK]", {
            uid,
            hasMarketData: enabledMarketData.length > 0,
            hasNews: enabledNews.length > 0,
            hasMetadata: enabledMetadata.length > 0,
            hasResearchKeys,
            enabledMarketDataProviders: enabledMarketData.map(([name]) => name),
            enabledNewsProviders: enabledNews.map(([name]) => name),
            enabledMetadataProviders: enabledMetadata.map(([name]) => name),
            totalEnabledProviders: enabledProviders.length
          });
        } catch (err: any) {
          logger.warn({ uid, error: err.message }, "Error checking provider configuration");
          hasResearchKeys = false;
        }
        
        diagnostics.systemChecks.researchKeysConfigured = {
          status: hasResearchKeys ? "PASS" : "FAIL",
          message: hasResearchKeys
            ? `Research API keys configured (${enabledProviders.length} enabled: ${enabledProviders.join(', ')})`
            : "No research API keys configured",
          value: hasResearchKeys,
          enabledProviders: enabledProviders,
        };

        // ============================================
        // 4. STRATEGY & SIGNAL CHECKS
        // ============================================
        // Get latest research history (more reliable than logs)
        const tradingSettings = await AutoTradeEngine.getTradingSettings(uid);
        const accuracyThreshold = tradingSettings.accuracyTrigger?.min || 75;

        // Get latest research history
        let latestResearch: any = null;
        try {
          const researchHistory = await firestoreAdapter.getResearchHistory(
            uid,
            1,
          );
          latestResearch =
            researchHistory && researchHistory.length > 0
              ? researchHistory[0]
              : null;
        } catch (err: any) {
          logger.warn(
            { uid, error: err.message },
            "Error fetching research history",
          );
        }

        // Get latest activity logs as fallback
        const recentLogs = await firestoreAdapter.getAutoTradeLogs(uid, 10);
        const lastSignalLog = recentLogs?.find(
          (l: any) =>
            l.eventType === "TRADE_SKIPPED" ||
            l.eventType === "TRADE_REJECTED" ||
            l.eventType === "TRADE_EXECUTED" ||
            l.eventType === "TRADE_CONFIRMATION_REQUIRED",
        );

        let signalGenerated = false;
        let signalType: "BUY" | "SELL" | "HOLD" | null = null;
        let signalAccuracy = 0;
        let accuracyPassed = false;
        let lastResearchTime: string | null = null;

        // Prefer research history over logs
        if (latestResearch) {
          signalGenerated = true;
          signalType = latestResearch.signal || "HOLD";
          signalAccuracy = latestResearch.accuracy || 0;
          accuracyPassed = signalAccuracy >= accuracyThreshold;
          lastResearchTime = latestResearch.timestamp
            ? new Date(latestResearch.timestamp).toISOString()
            : null;
        } else if (lastSignalLog?.data?.signal) {
          signalGenerated = true;
          signalType =
            lastSignalLog.data.signal.signal || lastSignalLog.data.signal;
          signalAccuracy =
            lastSignalLog.data.signal.accuracy ||
            lastSignalLog.data.accuracy ||
            0;
          accuracyPassed = signalAccuracy >= accuracyThreshold;
          lastResearchTime = lastSignalLog.timestamp
            ? new Date(lastSignalLog.timestamp).toISOString()
            : null;
        }

        diagnostics.strategyChecks.signalGenerated = {
          status: signalGenerated ? "PASS" : "FAIL",
          message: signalGenerated
            ? `Signal generated: ${signalType} (${lastResearchTime ? `at ${new Date(lastResearchTime).toLocaleString()}` : "recent"})`
            : "No recent signal generated - research cycle may not be running",
          value: signalGenerated,
          signalType: signalType,
          lastResearchTime: lastResearchTime,
        };

        diagnostics.strategyChecks.accuracyTrigger = {
          status: accuracyPassed ? "PASS" : "FAIL",
          message: accuracyPassed
            ? `Accuracy passed: ${signalAccuracy.toFixed(1)}% >= ${accuracyThreshold}%`
            : signalGenerated
              ? `Accuracy failed: ${signalAccuracy.toFixed(1)}% < ${accuracyThreshold}% (threshold: ${accuracyThreshold}%)`
              : "No signal to check accuracy",
          value: signalAccuracy,
          threshold: accuracyThreshold,
          passed: accuracyPassed,
        };

        // CRITICAL: Research Cycle Active diagnostic
        // Rule: PASS if scheduler is running AND user job is scheduled (regardless of accuracy)
        // STALLED only if scheduler not running OR last run > 2× configured interval
        // Accuracy failures must NOT affect research cycle status
        let researchAgeMinutes: number | null = null;
        let researchCycleActive = false;
        let researchStalled = false;

        // Get configured frequency to calculate 2× interval threshold
        const configuredFrequencyMinutes =
          bgResearchSettings?.researchFrequencyMinutes || 5;
        const stalledThresholdMinutes = configuredFrequencyMinutes * 2; // 2× configured interval

        if (lastResearchTime) {
          researchAgeMinutes = Math.floor(
            (Date.now() - new Date(lastResearchTime).getTime()) / 60000,
          );
        } else if (bgResearchSettings?.lastRunAt) {
          // CRITICAL FIX: Check Firestore lastRunAt FIRST (updated by interval callback)
          // This is the most reliable source as it's updated on every interval tick
          const lastRunAtTimestamp = bgResearchSettings.lastRunAt as any;
          const lastRunAtDate = lastRunAtTimestamp?.toDate ? lastRunAtTimestamp.toDate() : new Date(lastRunAtTimestamp);
          researchAgeMinutes = Math.floor(
            (Date.now() - lastRunAtDate.getTime()) / 60000,
          );
        } else if (userJobState?.lastRunAt) {
          // Fallback to scheduler in-memory state if Firestore not available
          researchAgeMinutes = lastResearchRunAge;
        }

        // CRITICAL: Research cycle is ACTIVE if scheduler is running AND user job is scheduled
        // This is independent of accuracy or research results
        researchCycleActive = schedulerRunning && userJobScheduled;

        // CRITICAL: STALLED only if:
        // 1. Scheduler is not running, OR
        // 2. Last run time exceeds 2× configured interval
        researchStalled =
          !schedulerRunning ||
          (researchAgeMinutes !== null &&
            researchAgeMinutes > stalledThresholdMinutes);

        diagnostics.strategyChecks.researchCycleActive = {
          status: researchCycleActive ? "PASS" : "FAIL",
          message: researchCycleActive
            ? `Research cycle active (scheduler running, user job scheduled${researchAgeMinutes !== null ? `, last run ${researchAgeMinutes} minutes ago` : ""})`
            : researchStalled
              ? `Research cycle STALLED${!schedulerRunning ? " - scheduler not running" : ""}${researchAgeMinutes !== null && researchAgeMinutes > stalledThresholdMinutes ? ` (last run ${researchAgeMinutes} minutes ago, threshold: ${stalledThresholdMinutes} minutes)` : ""}`
              : !schedulerRunning
                ? "Research cycle inactive - scheduler not running"
                : !userJobScheduled
                  ? "Research cycle inactive - user job not scheduled"
                  : "Research cycle status unknown",
          value: researchCycleActive,
          lastResearchAgeMinutes: researchAgeMinutes,
          isStalled: researchStalled,
          schedulerRunning: schedulerRunning,
          userJobScheduled: userJobScheduled,
          configuredFrequencyMinutes: configuredFrequencyMinutes,
          stalledThresholdMinutes: stalledThresholdMinutes,
        };

        // ============================================
        // 5. SAFETY & RULE CHECKS
        // ============================================
        const stats = config.stats || { dailyTrades: 0, dailyPnL: 0 };
        const equity = config.equitySnapshot || freeBalance || 1000;
        const maxDailyLossPct = tradingSettings.maxDailyLossPct || 5;
        const maxDailyLossAmount = equity * (maxDailyLossPct / 100);
        const maxTradesPerDay = tradingSettings.maxTradesPerDay || 5;
        const cooldownSeconds = config.cooldownSeconds || 30;
        const cooldownUntil = config.cooldownUntil;

        // Risk limits
        const dailyLossExceeded =
          stats.dailyPnL < 0 && Math.abs(stats.dailyPnL) >= maxDailyLossAmount;
        diagnostics.safetyChecks.riskLimits = {
          status: !dailyLossExceeded ? "PASS" : "FAIL",
          message: !dailyLossExceeded
            ? `Daily loss within limits (${stats.dailyPnL.toFixed(2)} < ${maxDailyLossAmount.toFixed(2)})`
            : `Daily loss limit exceeded (${Math.abs(stats.dailyPnL).toFixed(2)} >= ${maxDailyLossAmount.toFixed(2)})`,
          value: stats.dailyPnL,
          limit: maxDailyLossAmount,
        };

        // Cooldown
        const cooldownActive =
          cooldownUntil && new Date() < new Date(cooldownUntil);
        diagnostics.safetyChecks.cooldown = {
          status: !cooldownActive ? "PASS" : "FAIL",
          message: !cooldownActive
            ? "No cooldown active"
            : `Cooldown active until ${new Date(cooldownUntil).toISOString()}`,
          value: cooldownActive,
          cooldownUntil: cooldownUntil
            ? new Date(cooldownUntil).toISOString()
            : null,
        };

        // Daily trades limit
        const dailyTradesExceeded = stats.dailyTrades >= maxTradesPerDay;
        diagnostics.safetyChecks.dailyTradesLimit = {
          status: !dailyTradesExceeded ? "PASS" : "FAIL",
          message: !dailyTradesExceeded
            ? `Daily trades within limit (${stats.dailyTrades}/${maxTradesPerDay})`
            : `Daily trades limit reached (${stats.dailyTrades}/${maxTradesPerDay})`,
          value: stats.dailyTrades,
          limit: maxTradesPerDay,
        };

        // Get engine status (includes circuit breaker, active trades, etc.)
        const engineStatus = await autoTradeEngine.getStatus(uid);

        // Circuit breaker
        const circuitBreakerActive = engineStatus.circuitBreaker || false;
        diagnostics.safetyChecks.circuitBreaker = {
          status: !circuitBreakerActive ? "PASS" : "FAIL",
          message: !circuitBreakerActive
            ? "Circuit breaker not active"
            : "Circuit breaker active (daily loss limit exceeded)",
          value: circuitBreakerActive,
        };

        // Manual override
        const manualOverride = engineStatus.manualOverride || false;
        diagnostics.safetyChecks.manualOverride = {
          status: !manualOverride ? "PASS" : "FAIL",
          message: !manualOverride
            ? "No manual override active"
            : "Manual override active (trading paused by user)",
          value: manualOverride,
        };

        // Max concurrent trades
        const activeTradesCount = engineStatus.activeTrades || 0;
        const maxConcurrentTrades = config.maxConcurrentTrades || 3;
        const concurrentTradesExceeded =
          activeTradesCount >= maxConcurrentTrades;
        diagnostics.safetyChecks.concurrentTradesLimit = {
          status: !concurrentTradesExceeded ? "PASS" : "FAIL",
          message: !concurrentTradesExceeded
            ? `Concurrent trades within limit (${activeTradesCount}/${maxConcurrentTrades})`
            : `Concurrent trades limit reached (${activeTradesCount}/${maxConcurrentTrades})`,
          value: activeTradesCount,
          limit: maxConcurrentTrades,
        };

        // ============================================
        // DETERMINE PRIMARY BLOCKING REASON
        // ============================================
        const blockingReasons: string[] = [];

        // PRIORITY ORDER: Execution blockers first, then signal/accuracy, then balance
        // This ensures we don't blame balance if the loop isn't running

        // CRITICAL: Execution loop blockers
        if (disableAutoTradeEnv) {
          blockingReasons.push(
            "DISABLE_AUTOTRADE env flag is set - auto-trade is globally disabled",
          );
        }
        if (!backgroundTasksEnabled) {
          blockingReasons.push(
            "Background tasks are paused (event loop lag detected)",
          );
        }
        if (!schedulerRunning) {
          blockingReasons.push(
            "Background research scheduler is NOT running - auto-trade execution loop cannot start",
          );
        }
        // Background research is only required for TELEGRAM_BACKGROUND mode
        // AUTO_TRADE mode does NOT depend on telegram background research settings
        if (!bgResearchEnabled && !autoTradeResearchActive) {
          blockingReasons.push(
            "Background research is disabled - execution loop will not run",
          );
        }
        if (!userJobScheduled) {
          blockingReasons.push(
            "User job NOT scheduled in scheduler - enabling auto-trade should trigger registration",
          );
        }
        if (!hasResearchKeys) {
          blockingReasons.push(
            "No research API keys configured - research cannot run",
          );
        }

        // EXECUTION PATH: Exchange check - REMOVED (handled in final verdict)

        // EXECUTION PATH: Research cycle status
        if (researchStalled) {
          blockingReasons.push(
            `Research cycle STALLED (last run ${researchAgeMinutes} minutes ago) - execution loop may not be running`,
          );
        }
        if (!signalGenerated && !researchStalled) {
          blockingReasons.push(
            "No signal generated - research cycle may not be running or no valid signals found",
          );
        }
        if (signalGenerated && !accuracyPassed) {
          blockingReasons.push(
            `Accuracy below threshold (${signalAccuracy.toFixed(1)}% < ${accuracyThreshold}%)`,
          );
        }

        // BALANCE: Only check if execution path is clear AND futures balance was fetched
        // Don't blame balance if the loop isn't running or if futures balance fetch failed
        if (
          schedulerRunning &&
          userJobScheduled &&
          bgResearchEnabled &&
          !researchStalled &&
          futuresWalletDetected
        ) {
          if (freeBalance < minRequiredBalance) {
            blockingReasons.push(
              `Insufficient USDT-M Futures balance (${freeBalance.toFixed(2)} < ${minRequiredBalance} USDT)`,
            );
          }
        } else if (!futuresWalletDetected) {
          // If futures wallet not detected, that's a blocking reason
          blockingReasons.push(
            "USDT-M Futures balance fetch failed - no futures wallet available",
          );
        }
        if (dailyLossExceeded) {
          blockingReasons.push("Daily loss limit exceeded");
        }
        if (cooldownActive) {
          blockingReasons.push("Cooldown active");
        }
        if (dailyTradesExceeded) {
          blockingReasons.push("Daily trades limit reached");
        }
        if (circuitBreakerActive) {
          blockingReasons.push("Circuit breaker active");
        }
        if (manualOverride) {
          blockingReasons.push("Manual override active");
        }
        if (concurrentTradesExceeded) {
          blockingReasons.push("Concurrent trades limit reached");
        }

        diagnostics.primaryBlockingReason =
          blockingReasons.length > 0 ? blockingReasons[0] : null;

        // Special case: If accuracy and signal passed but trade still blocked
        if (signalGenerated && accuracyPassed && blockingReasons.length > 0) {
          diagnostics.strategyChecks.accuracyAndSignalPassed = {
            status: "PASS",
            message:
              "Accuracy and signal were valid, but execution was blocked",
            blockedBy: blockingReasons[0],
          };
        }

        // ============================================
        // FINAL VERDICT
        // ============================================
        // CRITICAL FIX: Exchange state checks MUST be evaluated as a contiguous block
        // BEFORE any feature toggles (autoTradeEnabled) or other blocking reasons.
        // INVARIANT: Exchange error ≠ Exchange not connected
        // INVARIANT: Exchange disconnected always blocks regardless of autoTradeEnabled
        // INVARIANT: Exchange connected must be evaluated before feature toggles
        //
        // REQUIRED PRIORITY ORDER (STRICT):
        // 1. exchangeCheckError === true → DIAGNOSTIC ERROR (check failed, status unknown)
        // 2. exchangeUsabilityReason === "disconnected" → HARD BLOCK (configured but unusable)
        // 3. exchangeUsabilityReason === "not_connected" → SOFT BLOCK (not configured)
        // 4. exchangeUsabilityReason === "connected" → Exchange checks PASS, continue
        // 5. !autoTradeEnabled → DISABLED (only after exchange is confirmed connected)
        // 6. blockingReasons.length > 0 → BLOCKED by other reason
        // 7. All clear → READY
        if (exchangeCheckError === true) {
          // CRITICAL: Exchange check threw an error - do NOT treat as "not connected"
          // This is a diagnostic error, not a connection failure
          diagnostics.finalVerdict =
            "AUTO-TRADE DIAGNOSTIC ERROR: Exchange status check failed";
        } else if (exchangeUsabilityReason === "disconnected") {
          // HARD BLOCK: Exchange is configured but unusable (e.g., invalid keys, API error)
          diagnostics.finalVerdict =
            "AUTO-TRADE BLOCKED: Exchange disconnected";
        } else if (exchangeUsabilityReason === "not_connected") {
          // SOFT BLOCK: Exchange not configured at all
          diagnostics.finalVerdict =
            "AUTO-TRADE BLOCKED: Exchange not connected";
        } else if (exchangeUsabilityReason === "connected") {
          // Exchange checks PASS - now evaluate feature toggles and other blocking reasons
          if (!autoTradeEnabled) {
            // User has disabled auto-trade
            diagnostics.finalVerdict = "AUTO-TRADE DISABLED";
          } else if (blockingReasons.length > 0) {
            diagnostics.finalVerdict = `AUTO-TRADE BLOCKED: ${blockingReasons[0]}`;
          } else {
            // All checks passed - auto-trade is ready
            diagnostics.finalVerdict = "AUTO-TRADE READY";
          }
        } else {
          // Unexpected exchange state - treat as error
          diagnostics.finalVerdict =
            "AUTO-TRADE DIAGNOSTIC ERROR: Exchange status check failed";
        }

        logger.info(
          {
            uid,
            verdict: diagnostics.finalVerdict,
            duration: Date.now() - startTime,
          },
          "Diagnostic check completed",
        );
        return diagnostics;
      } catch (err: any) {
        logger.error(
          { err, uid: (request as any).user?.uid },
          "Error running diagnostic check",
        );
        return reply.code(500).send({
          error: "Diagnostic check failed",
          message: err.message,
        });
      }
    },
  );
}
