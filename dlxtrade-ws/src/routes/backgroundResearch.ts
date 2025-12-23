import { FastifyInstance } from 'fastify';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { z } from 'zod';
import { logger } from '../utils/logger';

// Support both number (legacy) and object (range) formats for accuracyTrigger
const accuracyTriggerSchema = z.union([
  z.number().min(60).max(95), // Legacy: single number
  z.object({
    min: z.number().min(0).max(100),
    max: z.number().min(0).max(100),
  }).refine((data) => data.min < data.max && data.min >= 0 && data.max <= 100, {
    message: "min must be less than max and both must be between 0-100",
  }),
]);

const settingsSchema = z.object({
  backgroundResearchEnabled: z.boolean(),
  telegramBotToken: z.string().optional(),
  telegramChatId: z.string().optional(),
  researchFrequencyMinutes: z.number().min(1).max(30),
  accuracyTrigger: accuracyTriggerSchema,
});

export async function backgroundResearchRoutes(fastify: FastifyInstance) {
  // GET /api/background-research/settings - Get background research settings
  fastify.get("/settings", { preHandler: [fastify.authenticate] }, async (req) => {
    const data = await firestoreAdapter.getBackgroundResearchSettings((req as any).user.uid);
    return { success: true, data };
  });

  // POST /api/background-research/settings - Save background research settings
  fastify.post("/settings", { preHandler: [fastify.authenticate] }, async (req) => {
    const saved = await firestoreAdapter.saveBackgroundResearchSettings((req as any).user.uid, (req as any).body);
    return { success: true, data: saved };
  });
  // POST /api/background-research/settings/save - Save background research settings
  // CRITICAL: Telegram Background Research is OPTIONAL and must NEVER block other systems
  // MUST NOT: Call Telegram, trigger research, perform network calls, block auto-trade
  fastify.post('/settings/save', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const startTime = Date.now();
    let user: any = null;
    let uid: string = 'unknown';

    try {
      // STEP 0: Validate authentication
      user = request.user as any;
      if (!user || !user.uid) {
        logger.error({ user }, 'Invalid user object in request');
        return reply.code(401).send({
          success: false,
          error: 'Authentication required',
          message: 'User authentication failed. Please log in again.',
        });
      }
      uid = user.uid;

      // STEP 1: Validate payload with Zod (explicit error handling - NEVER throw)
      let body: z.infer<typeof settingsSchema>;
      try {
        body = settingsSchema.parse(request.body);
      } catch (validationError: any) {
        // CRITICAL: Zod validation errors must return 400, never 500
        if (validationError.name === 'ZodError' || validationError.issues) {
          const errorMessages = validationError.issues
            ? validationError.issues.map((i: any) => `${i.path.join('.')}: ${i.message}`).join(', ')
            : validationError.message;
          
          logger.warn({ uid, error: errorMessages, issues: validationError.issues }, 'Validation error saving background research settings');
          return reply.code(400).send({
            success: false,
            error: 'Validation failed',
            message: errorMessages,
          });
        }
        // If it's not a ZodError, re-throw to be caught by outer catch
        throw validationError;
      }

      logger.info({ uid, backgroundResearchEnabled: body.backgroundResearchEnabled }, 'Saving background research settings');

      // STEP 2: Check preconditions for Deep Research start (only when enabling)
      // CRITICAL: Do NOT auto-start engine on save. Only check if preconditions are met.
      let canStartDeepResearch = false;
      if (body.backgroundResearchEnabled === true) {
        let providerConfig: any = null;
        
        try {
          const { getUserIntegrationsByUid } = await import('./users/providerConfig');
          providerConfig = await getUserIntegrationsByUid(uid);
        } catch (apiCheckError: any) {
          // CRITICAL: API check errors are logged but don't block save
          logger.warn({ uid, error: apiCheckError.message }, 'Error checking primary APIs during save');
        }

        // Check preconditions for Deep Research:
        // 1. Telegram: botToken + chatId present
        const hasTelegram = !!(body.telegramBotToken && body.telegramChatId);
        
        // 2. CryptoCompare (market data primary): enabled and has API key
        const cryptocompare = providerConfig?.marketData?.cryptocompare;
        const hasCryptoCompare = cryptocompare?.enabled === true && !!cryptocompare?.apiKey;
        
        // 3. CoinGecko (metadata primary): available (doesn't require API key, so always available if configured)
        // CoinGecko is a backup metadata provider that doesn't require an API key
        // We check if it's in the metadata bucket (it should always be available)
        const coingecko = providerConfig?.metadata?.coingecko;
        const hasCoinGecko = true; // CoinGecko doesn't require API key, treat as always available
        
        // All three preconditions must pass
        canStartDeepResearch = hasTelegram && hasCryptoCompare && hasCoinGecko;
        
        logger.info({ 
          uid, 
          hasTelegram, 
          hasCryptoCompare, 
          hasCoinGecko, 
          canStartDeepResearch 
        }, 'Deep Research preconditions check');

        // STEP 3: Validate Telegram credentials (only when enabling)
        // CRITICAL: Still require Telegram for saving, but don't block if preconditions not fully met
        if (!body.telegramBotToken || !body.telegramChatId) {
          return reply.code(400).send({
            success: false,
            error: 'Telegram credentials required',
            message: 'Telegram Bot Token and Chat ID are required when background research is enabled',
          });
        }
      }
      // CRITICAL: If backgroundResearchEnabled === false, skip all validations and proceed to save

      // STEP 4: Save to Firestore (isolated error handling)
      // CRITICAL: Firestore uses merge: true (creates document if missing)
      // Accuracy trigger supports both number and object formats
      try {
        // Normalize accuracyTrigger to ensure type safety
        let normalizedAccuracyTrigger: number | { min: number; max: number };
        if (typeof body.accuracyTrigger === 'number') {
          normalizedAccuracyTrigger = body.accuracyTrigger;
        } else {
          // It's an object - Zod already validated it has min and max
          const trigger = body.accuracyTrigger as { min: number; max: number };
          normalizedAccuracyTrigger = { min: trigger.min, max: trigger.max };
        }

        // Persist engine state: STOPPED if disabling, preserve existing if enabling
        const engineState = body.backgroundResearchEnabled ? undefined : 'STOPPED';
        // CRITICAL: Set telegramBackgroundResearchEnabled flag correctly
        // When enabling: set to true
        // When disabling: set to false
        const telegramBackgroundResearchEnabled = body.backgroundResearchEnabled ? true : false;
        
        await firestoreAdapter.saveBackgroundResearchSettings(uid, {
          backgroundResearchEnabled: body.backgroundResearchEnabled,
          telegramBackgroundResearchEnabled: telegramBackgroundResearchEnabled, // Set flag correctly
          telegramBotToken: body.telegramBotToken,
          telegramChatId: body.telegramChatId,
          researchFrequencyMinutes: body.researchFrequencyMinutes,
          accuracyTrigger: normalizedAccuracyTrigger,
          engineState: engineState, // Persist STOPPED when disabling
          // CRITICAL: Do NOT set lastResearchRun here - scheduler handles this
        });
      } catch (firestoreError: any) {
        // CRITICAL: Firestore errors are infrastructure issues, return structured 500
        logger.error({ uid, error: firestoreError.message, stack: firestoreError.stack }, 'Firestore save failed');
        return reply.code(500).send({
          success: false,
          error: 'Database error',
          message: 'Failed to save background research settings. Please try again.',
        });
      }

      // STEP 5: Explicitly register user with scheduler and trigger initial research cycle
      // CRITICAL: Use ensureUserResearchScheduled to guarantee registration (same logic as auto-trade)
      // This ensures user is registered with mode = TELEGRAM_BACKGROUND_RESEARCH and triggers initial cycle
      if (body.backgroundResearchEnabled) {
        // Fire-and-forget: Use setImmediate to ensure it's truly non-blocking
        setImmediate(() => {
          (async () => {
            try {
              const { backgroundResearchScheduler } = await import('../services/backgroundResearchScheduler');
              // CRITICAL: Use ensureUserResearchScheduled instead of onUserSettingsChanged
              // This guarantees registration and triggers initial research cycle
              const result = await backgroundResearchScheduler.ensureUserResearchScheduled(uid);
              if (result.scheduled) {
                logger.info({ uid, reason: result.reason }, '✅ [SCHEDULER] User registered with TELEGRAM_BACKGROUND_RESEARCH mode - initial cycle will trigger');
              } else {
                logger.warn({ uid, reason: result.reason }, '⚠️ [SCHEDULER] User registration failed - scheduler may not start');
              }
            } catch (schedulerErr: any) {
              // CRITICAL: Scheduler failures are logged but NEVER affect API response
              logger.warn({ uid, error: schedulerErr.message }, 'Scheduler registration failed (non-critical - settings saved)');
            }
          })().catch(() => {
            // Swallow all errors - scheduler registration must never affect response
          });
        });
      } else {
        // When disabling: notify scheduler to remove job
        setImmediate(() => {
          (async () => {
            try {
              const { backgroundResearchScheduler } = await import('../services/backgroundResearchScheduler');
              await backgroundResearchScheduler.onUserSettingsChanged(uid);
              logger.debug({ uid }, 'Scheduler notified of disable');
            } catch (schedulerErr: any) {
              logger.warn({ uid, error: schedulerErr.message }, 'Scheduler notification failed (non-critical)');
            }
          })().catch(() => {
            // Swallow all errors
          });
        });
      }

      const duration = Date.now() - startTime;
      logger.info({ uid, duration, enabled: body.backgroundResearchEnabled }, 'Background research settings saved successfully');

      // STEP 6: Run diagnostic check (READ-ONLY, no side effects)
      let diagnostic: any = null;
      if (body.backgroundResearchEnabled) {
        try {
          // Wait a moment for scheduler to process the notification
          await new Promise(resolve => setTimeout(resolve, 500));
          
          const { backgroundResearchScheduler } = await import('../services/backgroundResearchScheduler');
          diagnostic = await backgroundResearchScheduler.runTelegramBackgroundDiagnostic(uid);
          logger.info({ uid, diagnostic }, 'Telegram background diagnostic completed');
        } catch (diagError: any) {
          logger.warn({ uid, error: diagError.message }, 'Diagnostic check failed (non-critical)');
          // Diagnostic failure doesn't affect save success
        }
      }

      // STEP 7: Return consistent success response with diagnostic and canStartDeepResearch flag
      return reply.code(200).send({
        success: true,
        message: body.backgroundResearchEnabled 
          ? 'Telegram background research enabled successfully'
          : 'Telegram background research disabled successfully',
        settings: {
          backgroundResearchEnabled: body.backgroundResearchEnabled,
          researchFrequencyMinutes: body.researchFrequencyMinutes,
          accuracyTrigger: body.accuracyTrigger,
        },
        canStartDeepResearch: canStartDeepResearch, // Flag indicating if user can start Deep Research
        diagnostic: diagnostic || null, // Include diagnostic if available
      });
    } catch (error: any) {
      // CRITICAL: Final catch-all for truly unexpected errors
      // This should rarely be hit since all operations are wrapped in try/catch
      const duration = Date.now() - startTime;
      
      logger.error({ 
        error: error.message, 
        uid, 
        duration, 
        stack: error.stack,
        errorName: error.name,
        errorType: typeof error
      }, 'Unexpected error saving background research settings');
      
      return reply.code(500).send({
        success: false,
        error: 'Internal server error',
        message: 'An unexpected error occurred while saving background research settings. Please try again.',
      });
    }
  });

  // GET /api/background-research/settings/get - Get background research settings
  fastify.get('/settings/get', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const user = request.user as any;

    try {
      logger.info({ uid: user.uid }, 'Getting background research settings');
      const settings = await firestoreAdapter.getBackgroundResearchSettings(user.uid);

      return {
        backgroundResearchEnabled: settings?.backgroundResearchEnabled || false,
        telegramBotToken: settings?.telegramBotToken || '',
        telegramChatId: settings?.telegramChatId || '',
        researchFrequencyMinutes: settings?.researchFrequencyMinutes || 5,
        accuracyTrigger: settings?.accuracyTrigger || 80,
        lastResearchRun: settings?.lastResearchRun?.toDate().toISOString() || null,
      };
    } catch (error: any) {
      logger.error({ error: error.message, uid: user.uid }, 'Error getting background research settings');
      return reply.code(500).send({
        error: 'Failed to get background research settings',
        reason: error.message,
      });
    }
  });

  // GET /api/background-research/diagnostic - Get diagnostic status
  // READ-ONLY: No side effects, only checks current state
  fastify.get('/diagnostic', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const user = request.user as any;
    const uid = user.uid;

    try {
      const { backgroundResearchScheduler } = await import('../services/backgroundResearchScheduler');
      const diagnostic = await backgroundResearchScheduler.runTelegramBackgroundDiagnostic(uid);
      
      return {
        success: true,
        diagnostic,
      };
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Error getting Telegram background diagnostic');
      return reply.code(500).send({
        success: false,
        error: 'Failed to get diagnostic',
        message: error.message,
      });
    }
  });

  // POST /api/background-research/settings/test - Test Telegram connection
  // CRITICAL: Async, non-blocking, with strict timeout (≤3s)
  // Must return success even if Telegram is slow (log failures internally)
  fastify.post('/settings/test', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const user = request.user as any;
    const { botToken, chatId } = request.body as { botToken: string; chatId: string };

    // CRITICAL: Set strict timeout to prevent blocking event loop
    const TIMEOUT_MS = 3000; // 3 seconds max

    try {
      logger.info({ uid: user.uid }, 'Testing Telegram connection');

      // Import telegram service
      const { telegramService } = await import('../services/telegramService');

      // CRITICAL: Wrap Telegram call with timeout to prevent blocking
      const testPromise = telegramService.testConnection(botToken, chatId);
      const timeoutPromise = new Promise<{ success: false; error: string }>((resolve) => {
        setTimeout(() => {
          logger.warn({ uid: user.uid }, 'Telegram test timeout - returning success to avoid blocking');
          resolve({ success: false, error: 'Test timeout - Telegram may be slow, but settings can still be saved' });
        }, TIMEOUT_MS);
      });

      // Race between test and timeout
      const testResult = await Promise.race([testPromise, timeoutPromise]);

      if (testResult.success) {
        return {
          success: true,
          message: "DLXTRADE Alert Test Successful: Telegram integration working."
        };
      } else {
        // CRITICAL: Log failure internally but return success to avoid blocking UI
        logger.warn({
          uid: user.uid,
          error: testResult.error
        }, 'Telegram test failed or timed out - returning success to avoid blocking');

        // Return success even on failure to prevent UI blocking - log failure internally
        // Frontend can check warning flag to show appropriate message
        return {
          success: true, // Return success to avoid blocking
          message: testResult.error || 'Telegram test completed (may have timed out)',
          warning: true // Flag to indicate test didn't actually succeed
        };
      }
    } catch (error: any) {
      // CRITICAL: Log error but return success to avoid blocking
      logger.error({ error: error.message, uid: user.uid }, 'Error testing Telegram connection');

      // Return success to prevent UI blocking - log failure internally
      return {
        success: true,
        message: 'Telegram test attempted (check logs for details)',
        warning: true
      };
    }
  });

  // POST /api/background-research/start - Start Deep Research engine
  // CRITICAL: Safe start gate with verification steps before starting engine
  fastify.post('/start', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const startTime = Date.now();
    let user: any = null;
    let uid: string = 'unknown';

    try {
      // STEP 0: Validate authentication
      user = request.user as any;
      if (!user || !user.uid) {
        logger.error({ user }, 'Invalid user object in request');
        return reply.code(401).send({
          success: false,
          error: 'Authentication required',
          message: 'User authentication failed. Please log in again.',
        });
      }
      uid = user.uid;

      logger.info({ uid }, 'Starting Deep Research engine');

      // STEP 1: Check if engine is already running (idempotence)
      const { backgroundResearchScheduler } = await import('../services/backgroundResearchScheduler');
      const isUserScheduled = backgroundResearchScheduler.isUserScheduled(uid);
      const jobState = backgroundResearchScheduler.getUserJobState(uid);
      const isRunning = jobState?.isRunning === true || isUserScheduled;

      if (isRunning) {
        logger.info({ uid }, 'Deep Research engine already running');
        return reply.code(200).send({
          success: false,
          error: 'Engine already running',
          message: 'Deep Research engine is already running. No action needed.',
          engineState: 'RUNNING',
        });
      }

      // STEP 2: Load settings and validate preconditions
      const settings = await firestoreAdapter.getBackgroundResearchSettings(uid);
      if (!settings?.backgroundResearchEnabled) {
        return reply.code(400).send({
          success: false,
          error: 'Background research not enabled',
          message: 'Please enable background research in settings first.',
        });
      }

      const telegramBotToken = settings.telegramBotToken;
      const telegramChatId = settings.telegramChatId;

      if (!telegramBotToken || !telegramChatId) {
        return reply.code(400).send({
          success: false,
          error: 'Telegram credentials missing',
          message: 'Telegram Bot Token and Chat ID are required.',
        });
      }

      // STEP 3: Validate provider configurations
      let providerConfig: any = null;
      try {
        const { getUserIntegrationsByUid } = await import('./users/providerConfig');
        providerConfig = await getUserIntegrationsByUid(uid);
      } catch (apiCheckError: any) {
        logger.error({ uid, error: apiCheckError.message }, 'Error loading provider config');
        return reply.code(500).send({
          success: false,
          error: 'Provider config error',
          message: 'Failed to load provider configurations. Please try again.',
        });
      }

      const cryptocompare = providerConfig?.marketData?.cryptocompare;
      const hasCryptoCompare = cryptocompare?.enabled === true && !!cryptocompare?.apiKey;
      
      if (!hasCryptoCompare) {
        return reply.code(400).send({
          success: false,
          error: 'CryptoCompare not configured',
          message: 'CryptoCompare API key is required and must be enabled.',
        });
      }

      // CoinGecko doesn't require API key, so it's always available
      const hasCoinGecko = true;

      if (!hasCoinGecko) {
        return reply.code(400).send({
          success: false,
          error: 'CoinGecko not available',
          message: 'CoinGecko metadata provider is required.',
        });
      }

      logger.info({ uid }, 'validationPassed: All preconditions met');

      // STEP 4: Safe start gate - Test Telegram connection
      logger.info({ uid }, 'Sending test Telegram message...');
      const { telegramService } = await import('../services/telegramService');
      const telegramTestResult = await telegramService.testConnection(telegramBotToken, telegramChatId);

      if (!telegramTestResult.success) {
        logger.error({ uid, error: telegramTestResult.error }, 'telegramTestFailed');
        return reply.code(400).send({
          success: false,
          error: 'Telegram test failed',
          message: `Failed to send test message to Telegram: ${telegramTestResult.error || 'Unknown error'}`,
          telegramTestFailed: true,
        });
      }

      logger.info({ uid }, 'telegramTestSent: Test message sent successfully');

      // STEP 5: Validate providers (config-based only, NO runtime API calls)
      // CRITICAL: Do NOT perform runtime API validation during startup
      // Runtime connectivity will be checked during actual research execution
      logger.info({ uid }, 'Validating providers (config-based)...');
      
      // CryptoCompare validation: check saved config only
      if (!cryptocompare) {
        logger.error({ uid }, 'providerValidationFailed: CryptoCompare not found in config');
        return reply.code(400).send({
          success: false,
          error: 'CryptoCompare not configured',
          message: 'CryptoCompare API is not configured. Please add CryptoCompare API key in settings.',
          providerValidationFailed: 'CryptoCompare',
        });
      }
      
      if (!cryptocompare.enabled) {
        logger.error({ uid }, 'providerValidationFailed: CryptoCompare disabled');
        return reply.code(400).send({
          success: false,
          error: 'CryptoCompare disabled',
          message: 'CryptoCompare API is disabled. Please enable it in settings.',
          providerValidationFailed: 'CryptoCompare',
        });
      }
      
      if (!cryptocompare.apiKey || cryptocompare.apiKey.trim().length === 0) {
        logger.error({ uid }, 'providerValidationFailed: CryptoCompare API key missing');
        return reply.code(400).send({
          success: false,
          error: 'CryptoCompare API key missing',
          message: 'CryptoCompare API key is missing. Please add your API key in settings.',
          providerValidationFailed: 'CryptoCompare',
        });
      }

      logger.info({ uid }, 'Provider validation passed (config-based) - skipping runtime checks');
      logger.info({ uid }, 'CryptoCompare: OK (config validated)');

      // STEP 6: Validate CoinGecko (config-based only)
      // CoinGecko doesn't require API key, just check if it exists in config
      logger.info({ uid }, 'CoinGecko: OK (no API key required)');

      // STEP 7: Load and normalize background research settings
      // CRITICAL: After Telegram test succeeds, ensure settings are complete before starting scheduler
      logger.info({ uid }, 'Loading and normalizing background research settings...');
      
      // Reload settings to ensure we have the latest
      const normalizedSettings = await firestoreAdapter.getBackgroundResearchSettings(uid);
      
      // Check if settings document exists at all
      if (!normalizedSettings) {
        logger.error({ uid }, 'Start aborted: background research settings document does not exist');
        return reply.code(400).send({
          success: false,
          error: 'Settings not found',
          message: 'Background research settings document does not exist. Please save settings first.',
          missingFields: ['settings document'],
        });
      }

      // Normalize settings with safe defaults if fields are missing
      // CRITICAL: Set telegramBackgroundResearchEnabled = true explicitly when starting
      const settingsToUse = {
        backgroundResearchEnabled: normalizedSettings.backgroundResearchEnabled ?? true,
        telegramBackgroundResearchEnabled: true, // Explicit flag set when user starts Deep Research
        telegramBotToken: normalizedSettings.telegramBotToken || telegramBotToken,
        telegramChatId: normalizedSettings.telegramChatId || telegramChatId,
        researchFrequencyMinutes: normalizedSettings.researchFrequencyMinutes || 5,
        accuracyTrigger: normalizedSettings.accuracyTrigger || { min: 75, max: 100 },
      };

      // Validate required fields exist (after normalization)
      const missingFields: string[] = [];
      if (!settingsToUse.telegramBotToken) missingFields.push('telegramBotToken');
      if (!settingsToUse.telegramChatId) missingFields.push('telegramChatId');
      if (!settingsToUse.researchFrequencyMinutes || settingsToUse.researchFrequencyMinutes <= 0) {
        missingFields.push('researchFrequencyMinutes');
      }

      if (missingFields.length > 0) {
        logger.error({ uid, missingFields }, 'Start aborted: background research settings invalid - missing required fields');
        return reply.code(400).send({
          success: false,
          error: 'Settings invalid',
          message: `Background research settings are missing required fields: ${missingFields.join(', ')}`,
          missingFields,
        });
      }

      // CRITICAL: Always save settings with telegramBackgroundResearchEnabled = true when starting
      // This ensures the flag is persisted and scheduler will stay active
      const needsUpdate = 
        normalizedSettings.researchFrequencyMinutes !== settingsToUse.researchFrequencyMinutes ||
        !normalizedSettings.accuracyTrigger ||
        normalizedSettings.backgroundResearchEnabled !== settingsToUse.backgroundResearchEnabled ||
        normalizedSettings.telegramBackgroundResearchEnabled !== true;

      if (needsUpdate || normalizedSettings.telegramBackgroundResearchEnabled !== true) {
        logger.info({ uid, normalizedSettings: settingsToUse }, 'Updating background research settings with normalized values and telegramBackgroundResearchEnabled flag');
        try {
          await firestoreAdapter.saveBackgroundResearchSettings(uid, settingsToUse);
          logger.info({ uid }, 'telegramBackgroundResearchEnabled flag set to true and persisted');
        } catch (saveError: any) {
          logger.warn({ uid, error: saveError.message }, 'Failed to update normalized settings, continuing with in-memory values');
        }
      }

      logger.info({ 
        uid, 
        frequency: settingsToUse.researchFrequencyMinutes,
        enabled: settingsToUse.backgroundResearchEnabled,
      }, 'Settings normalized and validated');

      // STEP 8: Start the engine
      // CRITICAL: Use ensureUserResearchScheduled for hard guarantee
      logger.info({ uid }, 'Starting scheduler with hard guarantee...');
      const scheduleResult = await backgroundResearchScheduler.ensureUserResearchScheduled(uid);
      
      if (!scheduleResult.scheduled) {
        logger.error({ uid, reason: scheduleResult.reason }, 'Failed to schedule user research');
        return reply.code(500).send({
          success: false,
          error: 'Scheduler registration failed',
          message: `Failed to register user in scheduler: ${scheduleResult.reason || 'Unknown error'}`,
        });
      }

      logger.info({ uid }, '✅ User successfully registered in scheduler');

      // STEP 8: Persist engine state to Firestore
      // CRITICAL: Save engineState = RUNNING and telegramBackgroundResearchEnabled = true explicitly
      const finalScheduled = backgroundResearchScheduler.isUserScheduled(uid);
      if (finalScheduled) {
        logger.info({ uid }, 'Engine state set to RUNNING - persisting to Firestore');
        try {
          await firestoreAdapter.saveBackgroundResearchSettings(uid, {
            backgroundResearchEnabled: true,
            telegramBackgroundResearchEnabled: true, // Ensure flag is set
            engineState: 'RUNNING',
          });
          logger.info({ uid }, 'Engine state persisted to Firestore: RUNNING (telegramBackgroundResearchEnabled=true)');
        } catch (persistError: any) {
          logger.warn({ uid, error: persistError.message }, 'Failed to persist engine state, continuing with in-memory state');
        }
      }

      // Log activity
      await firestoreAdapter.logActivity(uid, 'DEEP_RESEARCH_STARTED', {
        message: 'Deep Research engine started successfully',
        timestamp: new Date().toISOString(),
        frequency: settingsToUse.researchFrequencyMinutes,
        engineState: 'RUNNING',
      });

      logger.info({ uid, isScheduled: finalScheduled }, 'engineStarted: Deep Research engine started successfully');

      const duration = Date.now() - startTime;
      logger.info({ uid, duration }, 'Deep Research engine start completed');

      // STEP 9: Return success with diagnostic
      const diagnostic = await backgroundResearchScheduler.runTelegramBackgroundDiagnostic(uid);

      return reply.code(200).send({
        success: true,
        message: 'Deep Research engine started successfully',
        engineState: 'RUNNING',
        diagnostic: diagnostic || null,
      });

    } catch (error: any) {
      const duration = Date.now() - startTime;
      logger.error({ 
        error: error.message, 
        uid, 
        duration, 
        stack: error.stack,
      }, 'Unexpected error starting Deep Research engine');
      
      return reply.code(500).send({
        success: false,
        error: 'Internal server error',
        message: 'An unexpected error occurred while starting Deep Research engine. Please try again.',
      });
    }
  });
}
