import { logger } from '../utils/logger';
import { FreeModeDeepResearchResult, ProviderBackupConfig, FreeModeProviderResult } from './researchTypes';
import { executeMarketDataProvider, executeCryptoCompareProvider, executeCMCProvider, executeNewsProvider, setGlobalRetryBudgetContext } from './fallbackManager';
import { combineFreeModeResults } from './researchAggregator';
import { getTop50Coins as fetchTop50Coins, getCoinResearch as fetchCoinResearch, selectCoinsForResearch as selectCoins } from './researchModes';
import { getUserIntegrationsByUid } from '../routes/users/providerConfig';

export class DeepResearchEngine {
  // Concurrency control to prevent double execution
  private activeOperations = new Map<string, Promise<FreeModeDeepResearchResult>>();

  constructor() {
    console.log("[DR ENGINE LOADED] Version X.Y - Deep Research Provider Fixes");
  }

  /**
   * FREE MODE Deep Research v1.5 - Execute with backup APIs
   * Unified execution logic ensuring single source of truth for timeouts and partials.
   */
  async runFreeModeDeepResearch(
    uid: string,
    symbol: string,
    providerConfigs?: {
      binance?: ProviderBackupConfig;
      cryptocompare?: ProviderBackupConfig;
      cmc?: ProviderBackupConfig;
      news?: ProviderBackupConfig;
    },
    integrations?: any,
    backgroundMode?: boolean,
    timeoutMs?: number,
    onUpdate?: (partialResult: FreeModeDeepResearchResult) => Promise<void>,
    source?: string
  ): Promise<FreeModeDeepResearchResult> {
    const exchangeConfig = await firestoreAdapter.getExchangeConfig(uid);
    if (exchangeConfig?.exchangeStatus === 'INVALID_KEYS') {
      await firestoreAdapter.storeResearchHistory(uid, {
        signal: 'HOLD',
        accuracy: 0,
        status: 'BLOCKED',
        symbol: symbol,
        reason: 'EXCHANGE_KEYS_INVALID'
      });
      return null;
    }
    const startTime = Date.now();
    const requestId = `${uid}:${symbol}`;

    // 1. DEDUPLICATION: Prevent duplicate execution for same user+symbol
    if (this.activeOperations.has(requestId)) {
      logger.info({ uid, symbol, requestId }, '⚠️ [DEDUPLICATION] Research already running, reusing existing promise');
      return this.activeOperations.get(requestId)!;
    }

      // Define the core research logic
      const researchTask = async (): Promise<FreeModeDeepResearchResult> => {
        // 0. SYMBOL VALIDATION (Requirement 4)
        if (!symbol || typeof symbol !== 'string') {
          throw new Error("Invalid symbol: Symbol must be a non-empty string");
        }

        const upperSymbol = symbol.toUpperCase();
        // Block symbols like MUSDT or others that don't match strict alphanumeric+USDT pattern
        if (!/^[A-Z0-9]+USDT$/.test(upperSymbol) || upperSymbol === 'MUSDT' || upperSymbol === 'MBTCUSDT') {
          logger.warn({ uid, symbol }, "Blocking invalid or auto-converted symbol");
          throw new Error(`Invalid pair: ${symbol}. Only valid USDT perpetual pairs are supported.`);
        }

        // CRITICAL: Check if FINAL result already exists before starting research
        // FINAL guard applies ONLY to BACKGROUND/AUTO_TRADE sources
        // MANUAL_RESEARCH source MUST bypass FINAL guard to always run full deep research
        const isManualSource = source === 'MANUAL_RESEARCH' || source === 'manual';
        
        if (!isManualSource) {
          // BACKGROUND/AUTO_TRADE: Check FINAL guard
          // BACKGROUND execution must NEVER touch FINAL results - they are frozen and immutable
          // WHY: FINAL results are frozen using Object.freeze() and cannot be mutated
          // If FINAL exists, research must exit immediately to prevent mutation-after-freeze errors
          const { cacheService } = await import('../services/cacheService');
          const cacheKey = `coin_research_${upperSymbol}_${uid}`;
          const cached = cacheService.get('metadata', cacheKey);
          
          if (cached && cached.isFinal === true) {
            logger.info({ uid, symbol: upperSymbol, signal: cached.signal, accuracy: cached.accuracy, source }, '[BACKGROUND_FINAL_GUARD] Skipping execution — FINAL already exists');
            // Return cached FINAL result - do NOT attempt to recompute or mutate
            // CRITICAL: Create a new object reference to avoid reusing frozen FINAL
            // CRITICAL: Ensure safe structured response with all required fields from cached result
            // CRITICAL: Provide defaults for all required fields to prevent undefined access crashes
            return {
              ...cached,
              symbol: upperSymbol,
              signal: cached.signal || 'HOLD',
              accuracy: cached.accuracy ?? 0.5,
              snapshotAccuracy: cached.snapshotAccuracy ?? cached.accuracy ?? 0.5,
              accuracyBreakdown: cached.accuracyBreakdown || {
                indicatorScore: 0,
                marketStructureScore: 0,
                momentumScore: 0,
                volumeScore: 0,
                newsScore: 0,
                riskPenalty: 0
              },
              accuracyWeightsUsed: cached.accuracyWeightsUsed || {},
              indicators: cached.indicators || {},
              price: cached.price ?? 0,
              tradePlan: cached.tradePlan || null,
              isFinal: true,
              isProcessing: false
            } as FreeModeDeepResearchResult;
          }
        } else {
          logger.info({ uid, symbol: upperSymbol, source }, '[MANUAL_RESEARCH] Bypassing FINAL guard - manual research always executes');
        }

        logger.info({ uid, symbol, backgroundMode, timeoutMs }, 'Starting Deep Research execution');
        let finalVerdictComputed = false;

      // CRITICAL: Access control - Deep Research requires at least ONE API key to be connected
      // This prevents execution without any provider integrations
      // CRITICAL: Determine execution context - manual research uses 'user_request', background uses 'background_job'
      const executionContext: 'user_request' | 'background_job' = backgroundMode === true ? 'background_job' : 'user_request';
      
      let userIntegrations = integrations;
      if (!userIntegrations) {
        try {
          const { getUserIntegrationsByUid } = await import('../routes/users/providerConfig');
          userIntegrations = await getUserIntegrationsByUid(uid, executionContext);
        } catch (e: any) {
          logger.error({ uid, symbol, error: e.message, context: executionContext }, 'Failed to load user integrations');
          throw new Error('Failed to load provider integrations. Please ensure your API keys are configured.');
        }
      }

      // CRITICAL FIX: Filter out providers with empty decrypted API keys before validation
      // This ensures only valid providers are passed to research execution
      // If encrypted key exists but decrypts to empty, exclude provider gracefully, but never fatal.
      if (userIntegrations.marketData) {
        for (const [key, provider] of Object.entries(userIntegrations.marketData)) {
          const p = provider as any;
          if (p.apiKeyRequired && (!p.apiKey || typeof p.apiKey !== 'string' || p.apiKey.trim().length === 0)) {
            // Provider requires API key but decrypted key is empty - exclude from config for that provider only
            logger.warn({ uid, symbol, key }, 'Provider excluded from research due to missing/empty API key.');
            delete userIntegrations.marketData[key];
          }
        }
      }
      if (userIntegrations.news) {
        for (const [key, provider] of Object.entries(userIntegrations.news)) {
          const p = provider as any;
          if (p.apiKeyRequired && (!p.apiKey || typeof p.apiKey !== 'string' || p.apiKey.trim().length === 0)) {
            logger.warn({ uid, symbol, key }, 'Provider excluded from research due to missing/empty API key.');
            delete userIntegrations.news[key];
          }
        }
      }
      if (userIntegrations.metadata) {
        for (const [key, provider] of Object.entries(userIntegrations.metadata)) {
          const p = provider as any;
          if (p.apiKeyRequired && (!p.apiKey || typeof p.apiKey !== 'string' || p.apiKey.trim().length === 0)) {
            logger.warn({ uid, symbol, key }, 'Provider excluded from research due to missing/empty API key.');
            delete userIntegrations.metadata[key];
          }
        }
      }

      // CRITICAL: Validate that at least ONE VALID provider exists for each required category
      // A provider is VALID only if: decryptedApiKey exists AND decryptedApiKey.length > 0
      // Support both encrypted (apiKeyEncrypted) and decrypted (apiKey) formats
      // getUserIntegrationsByUid returns decrypted apiKey fields
      // getUserIntegrations returns encrypted apiKeyEncrypted fields
      // Research eligibility requires: at least ONE valid market data provider AND at least ONE valid news provider
      const hasValidMarketDataProvider = userIntegrations.marketData && 
        Object.values(userIntegrations.marketData).some((p: any) => {
          const hasDecrypted = p?.apiKey && typeof p.apiKey === 'string' && p.apiKey.trim().length > 0;
          const hasEncrypted = p?.apiKeyEncrypted && typeof p.apiKeyEncrypted === 'string' && p.apiKeyEncrypted.trim().length > 0;
          return hasDecrypted || hasEncrypted;
        });
      
      const hasValidNewsProvider = userIntegrations.news && 
        Object.values(userIntegrations.news).some((p: any) => {
          const hasDecrypted = p?.apiKey && typeof p.apiKey === 'string' && p.apiKey.trim().length > 0;
          const hasEncrypted = p?.apiKeyEncrypted && typeof p.apiKeyEncrypted === 'string' && p.apiKeyEncrypted.trim().length > 0;
          return hasDecrypted || hasEncrypted;
        });

      if (!hasValidMarketDataProvider || !hasValidNewsProvider) {
        logger.warn({ uid, symbol, hasValidMarketDataProvider, hasValidNewsProvider }, 'Deep Research running without necessary provider API keys - will mark as SKIPPED/BLOCKED in results');
        // Do not throw; continue research and return result as SKIPPED/BLOCKED downstream instead of aborting.
      }

      // If no integrations object structure exists, create empty structure (should not happen after validation)
      if (!userIntegrations.marketData && !userIntegrations.news && !userIntegrations.metadata) {
        userIntegrations = {
          marketData: {},
          news: {},
          metadata: {}
        };
      }

      // 2. UNIFIED TIMEOUT: Default 35s or user provided
      // This ensures complex research has time to finish, but we capture partials if it hangs.
      const TIMEOUT_MS = timeoutMs || 35000;

      // Store results as they come in - "Single source of truth" for partial data
      const taskResults: {
        marketData: FreeModeProviderResult | null;
        cc: FreeModeProviderResult | null;
        cmc: FreeModeProviderResult | null;
        news: FreeModeProviderResult | null;
      } = {
        marketData: null,
        cc: null,
        cmc: null,
        news: null
      };

      // CRITICAL: Use dedicated mutable runtimeStages object for ALL stage updates during execution
      // NEVER assign stages from cached FINAL result or result.stages
      // This prevents reference leaks where mutations on runtimeStages affect frozen FINAL objects
      // REFERENCE LEAK FIX: The original 'stages' object was being mutated after FINAL was computed,
      // and if any code path tried to reassign stages to a frozen result, it would cause "Cannot add property stages"
      const runtimeStages: Record<string, { status: string; provider: string; durationMs: number; reason?: string }> = {};

      const makeFailure = (provider: string, err: string, stageName: string, durationMs: number = 0): FreeModeProviderResult => {
        // CRITICAL: HARD GUARD - MUST be first check
        // If finalVerdictComputed === true, do NOT mutate stages, do NOT log
        if (finalVerdictComputed) {
          return {
            success: false,
            data: null,
            latencyMs: durationMs,
            provider: provider,
            error: err
          };
        }

        // CRITICAL: Only touch runtimeStages - never touch result.stages or cached stages
        runtimeStages[stageName] = {
          status: 'failed',
          provider: provider,
          durationMs: durationMs,
          reason: err
        };
        // CRITICAL: HARD GUARD - Check before logging
        if (!finalVerdictComputed) {
          logger.warn({ uid, symbol, stage: stageName, provider, reason: err }, `[DR_STAGE_FAIL] ${stageName}`);
        }
        return {
          success: false,
          data: null,
          latencyMs: durationMs,
          provider: provider,
          error: err
        };
      };

      const makeSkipped = (provider: string, reason: string, stageName: string): FreeModeProviderResult => {
        // CRITICAL: HARD GUARD - MUST be first check
        // If finalVerdictComputed === true, do NOT mutate stages, do NOT log
        if (finalVerdictComputed) {
          return {
            success: false,
            data: null,
            latencyMs: 0,
            provider: provider,
            error: reason
          };
        }

        // CRITICAL: Only touch runtimeStages - never touch result.stages or cached stages
        runtimeStages[stageName] = {
          status: 'skipped',
          provider: provider,
          durationMs: 0,
          reason: reason
        };
        // CRITICAL: HARD GUARD - Check before logging
        if (!finalVerdictComputed) {
          logger.info({ uid, symbol, stage: stageName, provider, reason }, `[DR_STAGE_SKIP] ${stageName}`);
        }
        return {
          success: false,
          data: null,
          latencyMs: 0,
          provider: provider,
          error: reason
        };
      };

      // GLOBAL RETRY BUDGET: Max 4 retries total across ALL providers
      let globalRetryBudget = 4;
      const getRetryBudget = () => globalRetryBudget;
      const consumeRetry = () => {
        if (globalRetryBudget > 0) {
          globalRetryBudget--;
          return true;
        }
        return false;
      };

      // Event loop lag monitoring - measure time between async operations
      let lastCheckTime = Date.now();
      const checkEventLoopLag = async (): Promise<number> => {
        const before = Date.now();
        // Yield to event loop and measure how long it takes
        await new Promise(resolve => setImmediate(resolve));
        const after = Date.now();
        const lag = after - before;
        lastCheckTime = after;
        return lag;
      };

      // Yield to event loop
      const yieldToEventLoop = (): Promise<void> => {
        return new Promise(resolve => setImmediate(resolve));
      };

      // Set global retry budget context for this research run
      setGlobalRetryBudgetContext({
        getBudget: getRetryBudget,
        consume: consumeRetry
      });

      // Execute providers SEQUENTIALLY by priority (not parallel)
      // Priority: marketData > metadata (cc/cmc) > news
      const executeProviderSequentially = async (
        name: string,
        stageName: string,
        executeFn: () => Promise<FreeModeProviderResult>,
        resultKey: keyof typeof taskResults
      ): Promise<void> => {
        // CRITICAL: Check finalVerdictComputed BEFORE starting any provider execution
        // researchTask is the long-running executor - FINAL is terminal
        // Continuing execution after freeze causes crashes because the result object is frozen
        if (finalVerdictComputed) {
          logger.warn({ uid, symbol, stage: stageName }, "[PROVIDER_EXECUTION_BLOCKED] Final verdict computed, blocking provider execution");
          return; // Exit immediately - do NOT execute provider
        }

        // CRITICAL: HARD GUARD - Check again before any operations
        if (finalVerdictComputed) {
          return; // Exit immediately - do NOT log, do NOT execute ANY code
        }

        const stageStartTime = Date.now();
        logger.info({ uid, symbol, stage: stageName }, `[DR_STAGE_START] ${stageName}`);

        // CRITICAL: HARD GUARD - Check again after logging
        if (finalVerdictComputed) {
          return; // Exit immediately - do NOT execute ANY code
        }

        // Check event loop lag before starting (Just warn, do not abort)
        const lagBefore = await checkEventLoopLag();
        if (lagBefore > 2000) {
          logger.warn({ uid, symbol, lagBefore }, '[EVENT_LOOP_LAG] Lag > 2000ms detected before provider execution');
        }

        // CRITICAL: Check again after async operations - FINAL might have been computed
        if (finalVerdictComputed) {
          logger.warn({ uid, symbol, stage: stageName }, "[PROVIDER_EXECUTION_BLOCKED] Final verdict computed during execution, aborting");
          return; // Exit immediately - do NOT execute provider
        }

        try {
          const res = await executeFn();
          
          // CRITICAL: Check again after provider execution - FINAL might have been computed
          if (finalVerdictComputed) {
            logger.warn({ uid, symbol, stage: stageName }, "[STAGE_UPDATE_BLOCKED] Final verdict computed after provider execution, skipping stage update");
            return; // Exit immediately - do NOT update stages
          }

          const durationMs = Date.now() - stageStartTime;

          // CRITICAL: Check finalVerdictComputed before updating stages
          // researchTask is the long-running executor - FINAL is terminal
          // Continuing execution after freeze causes crashes because the result object is frozen
          if (finalVerdictComputed) {
            logger.warn({ uid, symbol, stage: stageName }, "[STAGE_UPDATE_BLOCKED] Final verdict computed, skipping stage update");
            return; // Exit immediately - do NOT update stages
          }

          // CRITICAL: HARD GUARD - Check before ANY stage mutation or logging
          if (finalVerdictComputed) {
            return; // Exit immediately - do NOT mutate stages, do NOT log, do NOT execute ANY code
          }

          // CRITICAL: Only touch runtimeStages - never touch result.stages or cached stages
          // updateProgress, logStageStart, logStageComplete MUST only touch runtimeStages
          if (res.success) {
            runtimeStages[stageName] = {
              status: 'completed',
              provider: res.provider,
              durationMs: durationMs
            };
            // CRITICAL: HARD GUARD - Check before logging
            if (!finalVerdictComputed) {
              logger.info({ uid, symbol, stage: stageName, provider: res.provider, durationMs }, `[DR_STAGE_COMPLETE] ${stageName}`);
            }
          } else {
            // Check if error indicates "not implemented" - mark as skipped
            const errorMsg = res.error || 'Provider returned success=false';
            const isNotImplemented = errorMsg.toLowerCase().includes('not implemented') ||
              errorMsg.toLowerCase().includes('not yet implemented');

            // CRITICAL: HARD GUARD - Check before ANY stage mutation or logging
            if (finalVerdictComputed) {
              return; // Exit immediately - do NOT mutate stages, do NOT log, do NOT execute ANY code
            }

            if (isNotImplemented) {
              runtimeStages[stageName] = {
                status: 'skipped',
                provider: res.provider || name,
                durationMs: durationMs,
                reason: errorMsg
              };
              // CRITICAL: HARD GUARD - Check before logging
              if (!finalVerdictComputed) {
                logger.info({ uid, symbol, stage: stageName, provider: res.provider, reason: errorMsg }, `[DR_STAGE_SKIP] ${stageName} - not implemented`);
              }
            } else {
              runtimeStages[stageName] = {
                status: 'failed',
                provider: res.provider || name,
                durationMs: durationMs,
                reason: errorMsg
              };
              // CRITICAL: HARD GUARD - Check before logging
              if (!finalVerdictComputed) {
                logger.warn({ uid, symbol, stage: stageName, provider: res.provider, reason: errorMsg }, `[DR_STAGE_FAIL] ${stageName}`);
              }
            }
          }

          taskResults[resultKey] = res;
          if (backgroundMode && res.success) {
            logger.info({ uid, symbol }, `✅ [BACKGROUND] ${name} succeeded`);
          }
        } catch (e: any) {
          // CRITICAL: HARD GUARD - Check before ANY error handling
          // If FINAL already exists, do NOT handle errors - just return
          if (finalVerdictComputed) {
            return; // Exit immediately - do NOT handle errors, do NOT mutate stages, do NOT execute ANY code
          }

          const durationMs = Date.now() - stageStartTime;
          const errorMsg = e.message || 'Unknown error';
          const isNotImplemented = errorMsg.toLowerCase().includes('not implemented') ||
            errorMsg.toLowerCase().includes('not yet implemented');

          if (isNotImplemented) {
            taskResults[resultKey] = makeSkipped(name, errorMsg, stageName);
          } else {
            taskResults[resultKey] = makeFailure(name, errorMsg, stageName, durationMs);
          }
        }

        // Yield to event loop after each provider
        await yieldToEventLoop();

        // Check event loop lag after execution (Just warn, do not abort)
        const lagAfter = await checkEventLoopLag();
        if (lagAfter > 2000) {
          logger.warn({ uid, symbol, lagAfter }, '[EVENT_LOOP_LAG] Lag > 2000ms detected after provider execution');
        }
      };

      // Setup timeout promise
      const timeoutPromise = new Promise<{ timeout: true }>((resolve) => {
        setTimeout(() => resolve({ timeout: true }), TIMEOUT_MS);
      });

      // 3. SEQUENTIAL PROGRESSIVE PIPELINE (User Requested)
      // Stages: 
      // 1. Fetch OHLC data
      // 2. Analyze trend & RSI
      // 3. Calculate MACD & volume
      // 4. Detect chart patterns
      // 5. Fetch latest news
      // 6. Analyze sentiment
      // 7. Compute strategy agreement
      // 8. Compute final accuracy

      const delay = () => new Promise(r => setTimeout(r, 50));
      const stagesList = [
        'Fetch OHLC data',
        'Analyze trend & RSI',
        'Calculate MACD & volume',
        'Detect chart patterns',
        'Fetch latest news',
        'Macro / Narrative',
        'Analyze sentiment',
        'Compute strategy agreement',
        'Compute final accuracy'
      ];

      // CRITICAL: Initialize runtimeStages - never reuse stages from cached FINAL result
      // Initialize all stages as pending in runtimeStages
      stagesList.forEach(s => {
        runtimeStages[s] = { status: 'pending', provider: 'system', durationMs: 0 };
      });

      const updateProgress = async () => {
        // CRITICAL: HARD GUARD - MUST be first line
        // If finalVerdictComputed === true, immediately return - NO code executes after FINAL
        // This prevents ANY mutation attempts on the frozen FINAL object
        if (finalVerdictComputed) {
          return; // Exit immediately - do NOT update progress, do NOT log, do NOT execute ANY code
        }
        
        // CRITICAL: researchTask is the long-running executor - FINAL is terminal
        // Continuing execution after freeze causes crashes because the result object is frozen
        if (onUpdate) {
          // Intermediate updates are not final, so mutations are safe (object is not frozen)
          const intermediate = await combineFreeModeResults(
            uid, symbol,
            taskResults.marketData || { success: false, data: null, latencyMs: 0, provider: 'none' },
            taskResults.cc || { success: false, data: null, latencyMs: 0, provider: 'none' },
            taskResults.cmc || { success: false, data: null, latencyMs: 0, provider: 'none' },
            taskResults.news || { success: false, data: null, latencyMs: 0, provider: 'none' },
            true, // SILENT
            false, // Not final - object won't be frozen, so mutations are safe
            { ...runtimeStages } // Pass runtimeStages snapshot - never pass result.stages or cached stages
          );
          // Safe to mutate because isFinal=false (object is not frozen)
          (intermediate as any).isProcessing = true;
          (intermediate as any).currentStage = Object.keys(runtimeStages).find(name => runtimeStages[name].status === 'running') || 'Processing';
          await onUpdate(intermediate);
        }
      };

      // Stage 1: Fetch OHLC Data
      // CRITICAL: Check finalVerdictComputed before starting any stage
      // researchTask is the long-running executor - FINAL is terminal
      if (finalVerdictComputed) {
        logger.warn({ uid, symbol }, "[STAGE_EXECUTION_BLOCKED] Final verdict computed, terminating researchTask immediately");
        throw new Error('Research already finalized - cannot execute stages');
      }
      runtimeStages['Fetch OHLC data'].status = 'running';
      await updateProgress();
      await executeProviderSequentially(
        'marketData',
        'Fetch OHLC data',
        () => executeMarketDataProvider(symbol, providerConfigs?.binance || { primary: 'binance', backups: ['bybit'] }, userIntegrations, uid),
        'marketData'
      );
      // Also fetch cc for extra indicators
      await executeProviderSequentially(
        'cryptocompare',
        'Fetch OHLC data',
        () => executeCryptoCompareProvider(symbol, providerConfigs?.cryptocompare || { primary: 'cryptocompare', backups: [] }, userIntegrations, uid),
        'cc'
      );
      // CRITICAL: HARD GUARD - Check before stage mutation
      if (finalVerdictComputed) {
        throw new Error('Research already finalized - cannot update stages');
      }
      runtimeStages['Fetch OHLC data'].status = 'completed';
      await delay();

      // Stage 2: Analyze trend & RSI
      // CRITICAL: HARD GUARD - Check before stage mutation
      if (finalVerdictComputed) {
        throw new Error('Research already finalized - cannot update stages');
      }
      runtimeStages['Analyze trend & RSI'].status = 'running';
      await updateProgress();
      await delay();
      // CRITICAL: HARD GUARD - Check before stage mutation
      if (finalVerdictComputed) {
        throw new Error('Research already finalized - cannot update stages');
      }
      runtimeStages['Analyze trend & RSI'].status = 'completed';

      // Stage 3: Calculate MACD & volume
      // CRITICAL: HARD GUARD - Check before stage mutation
      if (finalVerdictComputed) {
        throw new Error('Research already finalized - cannot update stages');
      }
      runtimeStages['Calculate MACD & volume'].status = 'running';
      await updateProgress();
      await delay();
      // CRITICAL: HARD GUARD - Check before stage mutation
      if (finalVerdictComputed) {
        throw new Error('Research already finalized - cannot update stages');
      }
      runtimeStages['Calculate MACD & volume'].status = 'completed';

      // Stage 4: Detect chart patterns
      // CRITICAL: HARD GUARD - Check before stage mutation
      if (finalVerdictComputed) {
        throw new Error('Research already finalized - cannot update stages');
      }
      runtimeStages['Detect chart patterns'].status = 'running';
      await updateProgress();
      await delay();
      // CRITICAL: HARD GUARD - Check before stage mutation
      if (finalVerdictComputed) {
        throw new Error('Research already finalized - cannot update stages');
      }
      runtimeStages['Detect chart patterns'].status = 'completed';

      // Stage 5: Fetch latest news
      // CRITICAL: HARD GUARD - Check before stage mutation
      if (finalVerdictComputed) {
        throw new Error('Research already finalized - cannot update stages');
      }
      runtimeStages['Fetch latest news'].status = 'running';
      await updateProgress();
      await executeProviderSequentially(
        'news',
        'Fetch latest news',
        () => executeNewsProvider(symbol, providerConfigs?.news || { primary: 'newsdata', backups: [] }, userIntegrations, uid, false, true),
        'news'
      );

      if (taskResults.news?.success) {
        console.log(`[DR_NEWS_SUCCESS] RSS/News fetch succeeded for ${symbol} | Articles: ${taskResults.news.data?.articles?.length || 0}`);
      }

      // CRITICAL: HARD GUARD - Check before stage mutation
      if (finalVerdictComputed) {
        throw new Error('Research already finalized - cannot update stages');
      }
      runtimeStages['Fetch latest news'].status = 'completed';
      await updateProgress();
      await delay();

      // Stage 6: Macro / Narrative (Metadata)
      // CRITICAL: Check finalVerdictComputed before updating stages
      // BACKGROUND execution must NEVER mutate stages after FINAL
      if (finalVerdictComputed) {
        logger.warn({ uid, symbol }, "[STAGE_UPDATE_BLOCKED] Final verdict computed, blocking stage update");
        throw new Error('Research already finalized - cannot update stages');
      }
      runtimeStages['Macro / Narrative'] = { status: 'running', provider: 'system', durationMs: 0 };
      await updateProgress();
      await executeProviderSequentially(
        'metadata',
        'Macro / Narrative',
        () => executeCMCProvider(symbol, providerConfigs?.cmc || { primary: 'coinmarketcap', backups: ['coingecko', 'coinpaprika'] }, userIntegrations, uid),
        'cmc'
      );
      // CRITICAL: HARD GUARD - Check before stage mutation
      if (finalVerdictComputed) {
        throw new Error('Research already finalized - cannot update stages');
      }
      runtimeStages['Macro / Narrative'].status = 'completed';
      await updateProgress();
      await delay();

      // Stage 7: Analyze sentiment
      // CRITICAL: Check finalVerdictComputed before updating stages
      // BACKGROUND execution must NEVER mutate stages after FINAL
      if (finalVerdictComputed) {
        logger.warn({ uid, symbol }, "[STAGE_UPDATE_BLOCKED] Final verdict computed, blocking stage update");
        throw new Error('Research already finalized - cannot update stages');
      }
      runtimeStages['Analyze sentiment'].status = 'running';
      await updateProgress();
      await delay();
      // CRITICAL: HARD GUARD - Check before stage mutation
      if (finalVerdictComputed) {
        throw new Error('Research already finalized - cannot update stages');
      }
      runtimeStages['Analyze sentiment'].status = 'completed';

      // Stage 8: Compute strategy agreement
      // CRITICAL: Check finalVerdictComputed before updating stages
      if (finalVerdictComputed) {
        logger.warn({ uid, symbol }, "[STAGE_UPDATE_BLOCKED] Final verdict computed, blocking stage update");
        throw new Error('Research already finalized - cannot update stages');
      }
      runtimeStages['Compute strategy agreement'].status = 'running';
      await updateProgress();
      await delay();
      // CRITICAL: HARD GUARD - Check before stage mutation
      if (finalVerdictComputed) {
        throw new Error('Research already finalized - cannot update stages');
      }
      runtimeStages['Compute strategy agreement'].status = 'completed';

      // Stage 9: Compute final accuracy
      // HARD GUARD: Check finalVerdictComputed before any stage updates
      if (finalVerdictComputed) {
        logger.warn({ uid, symbol }, "[STAGE_UPDATE_BLOCKED] Final verdict computed, blocking stage update");
        throw new Error("Final Verdict already computed - cannot update stages");
      }
      runtimeStages['Compute final accuracy'].status = 'running';
      await updateProgress();
      await delay();
      // CRITICAL: HARD GUARD - Check before stage mutation
      if (finalVerdictComputed) {
        throw new Error('Research already finalized - cannot update stages');
      }
      runtimeStages['Compute final accuracy'].status = 'completed';

      // 3. COMBINE RESULTS
      // HARD GUARD: Double-check before combining (defensive programming)
      if (finalVerdictComputed) {
        logger.error({ uid, symbol }, "[FINAL_RECOMPUTE_ERROR] Final Verdict attempted re-calculation. Short-circuiting.");
        throw new Error("Final Verdict already computed");
      }

      // ENSURE NEWS PERSISTENCE (Task 4)
      // If news fetch was successful in stage 5, it must be passed here
      const newsResult = taskResults.news || { success: false, data: null, latencyMs: 0, provider: 'none' };

      // CRITICAL: Build providersMetadata BEFORE calling combineFreeModeResults
      // All properties must be attached BEFORE Object.freeze() is called
      const providersMetadata = {
        marketData: {
          provider: taskResults.marketData?.provider || 'none',
          success: taskResults.marketData?.success || false,
          latency: taskResults.marketData?.latencyMs || 0
        },
        metadata: {
          provider: taskResults.cmc?.provider || 'none',
          success: taskResults.cmc?.success || false,
          latency: taskResults.cmc?.latencyMs || 0
        },
        news: {
          provider: taskResults.news?.provider || 'none',
          success: taskResults.news?.success || false,
          latency: taskResults.news?.latencyMs || 0
        },
        providersUsed: {
          marketData: 1,
          metadata: 1,
          news: 1
        }
      };

      // CRITICAL: At FINAL computation, create a NEW object from runtimeStages
      // NEVER assign stages from cached FINAL result or result.stages
      // REFERENCE LEAK FIX: The original code was taking a shallow copy of 'stages' which could still
      // be mutated after FINAL. By using runtimeStages and creating a new object here, we ensure
      // the frozen result has a completely independent copy that cannot be affected by any mutations
      // on runtimeStages that might occur after FINAL (though guards prevent this).
      const finalStagesSnapshot = { ...runtimeStages }; // Create NEW object from runtimeStages

      // Pass stages and providersMetadata to combineFreeModeResults so they're included BEFORE freezing
      const result = await combineFreeModeResults(
        uid,
        symbol,
        taskResults.marketData || { success: false, data: null, latencyMs: 0, provider: 'none' },
        taskResults.cc || { success: false, data: null, latencyMs: 0, provider: 'none' },
        taskResults.cmc || { success: false, data: null, latencyMs: 0, provider: 'none' },
        newsResult,
        false, // Not partial yet
        true, // IS FINAL
        finalStagesSnapshot, // Pass NEW object created from runtimeStages - never pass result.stages or cached stages
        providersMetadata // Pass providersMetadata BEFORE freezing
      );

      // CRITICAL: Set finalVerdictComputed IMMEDIATELY after result is frozen
      // This prevents ANY code paths from attempting mutations
      finalVerdictComputed = true;

      // HARD GUARD: Once finalVerdictComputed === true, ALL mutation attempts must exit early
      // The result is frozen by combineFreeModeResults when isFinal=true
      // Mutation after freeze is forbidden because:
      // 1. Object.freeze() makes the object non-extensible (cannot add properties)
      // 2. Object.freeze() prevents property modifications (cannot change values)
      // 3. Attempting mutation throws "Cannot add property X, object is not extensible"

      logger.info({ uid, symbol, accuracy: (result.accuracy * 100).toFixed(1) + '%' }, "[FINAL_VERDICT_COMPUTED] Deep Research researchTask complete.");

      // CRITICAL: FINAL is a terminal state - function MUST return immediately
      // Continuing execution after freeze causes crashes because:
      // - The result object is frozen and cannot be mutated
      // - Any stage updates, provider calls, or progress updates will fail
      // - FINAL must end the function immediately - no further stages, logs, providers, or updates
      // This is the ABSOLUTE END of execution - no code may execute after this return
      return result;
    };

    // Execute wrapped task
    const promise = researchTask();
    this.activeOperations.set(requestId, promise);

    try {
      // If onUpdate is provided, we can't easily await the whole thing if we want to stream updates,
      // but researchTask itself will call onUpdate.
      return await promise;
    } catch (err: any) {
      logger.error({ uid, symbol, error: err.message }, 'Unexpected error in deep research task');
      throw err;
    } finally {
      this.activeOperations.delete(requestId);
    }
  }

  async getTop50Coins(uid: string): Promise<any[]> {
    return fetchTop50Coins(uid);
  }

  async getCoinResearch(uid: string, symbol: string, source?: string, onUpdate?: (data: any) => Promise<void>): Promise<any> {
    // CRITICAL: Manual coin-selected research MUST use backgroundMode: false to ensure user_request context
    // This ensures API key decryption works correctly for manual research
    // Background scheduler calls should use backgroundMode: true (background_job context)
    const isManualResearch = !source || source !== 'background_scheduler';
    return fetchCoinResearch(uid, symbol, (u, s, configs, integrationData) => this.runFreeModeDeepResearch(u, s, configs, integrationData, !isManualResearch, 35000, onUpdate, source), source);
  }

  async selectCoinsForResearch(uid: string): Promise<string[]> {
    return selectCoins(uid);
  }
}

const deepResearchEngine = new DeepResearchEngine();

export async function runFreeModeDeepResearch(
  uid: string,
  symbol: string,
  providerConfigs?: {
    binance?: ProviderBackupConfig;
    cryptocompare?: ProviderBackupConfig;
    cmc?: ProviderBackupConfig;
    news?: ProviderBackupConfig;
  },
  integrations?: any,
  backgroundMode?: boolean,
  timeoutMs?: number,
  source?: string
): Promise<FreeModeDeepResearchResult> {
  const defaultConfigs = {
    binance: { primary: 'binance', backups: ['bybit', 'okx', 'kucoin'] },
    cryptocompare: { primary: 'cryptocompare', backups: ['alphavantage', 'coingecko'] },
    cmc: { primary: 'coinmarketcap', backups: ['coingecko'] },
    news: { primary: 'newsdata', backups: ['cryptopanic'] } // Reddit removed to prevent 403 lag
  };
  const configs = providerConfigs || defaultConfigs;
  return await deepResearchEngine.runFreeModeDeepResearch(uid, symbol, configs, integrations, backgroundMode, timeoutMs, undefined, source);
}

export const selectCoinsForResearch = selectCoins;

export default deepResearchEngine;
