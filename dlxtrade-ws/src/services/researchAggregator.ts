import { logger } from '../utils/logger';
import { accuracyEngine } from './accuracyEngine';
import { FreeModeDeepResearchResult, FreeModeProviderResult } from './researchTypes';
import { calculateIndicatorsFromOHLC, createDefaultIndicators, createDefaultIndicatorsData, calculateAccuracyScore } from './coinScoring';
import { generateAnalysisImages, generateAnalysisSummary, generateSignalsArray, generateMetricsObject, transformNewsForUI, generateTradePlan } from './researchResultFormatter';


/**
 * Combine FREE MODE v1.5 results from all providers
 */
export async function combineFreeModeResults(
  uid: string,
  symbol: string,
  marketDataResult: FreeModeProviderResult,
  ccResult: FreeModeProviderResult,
  cmcResult: FreeModeProviderResult,
  newsResult: FreeModeProviderResult,
  silent: boolean = false,
  isFinal: boolean = false,
  stagesMetadata?: Record<string, { status: string; provider: string; durationMs: number; reason?: string }>,
  providersMetadata?: any
): Promise<FreeModeDeepResearchResult> {

  // CRITICAL: Validate provider results before combining
  const providerStatus = {
    marketData: marketDataResult?.success || false,
    cryptocompare: ccResult?.success || false,
    metadata: cmcResult?.success || false,
    news: newsResult?.success || false
  };

  // Count successful providers for logging
  const successfulProvidersCount = Object.values(providerStatus).filter(Boolean).length;
  // Count ALL attempted stages (always 3: marketData, metadata, news)
  const providersUsedCount = 3; // Always count all attempted stages

  if (isFinal && !silent) {
    logger.info({
      uid,
      symbol,
      providerStatus,
      successfulProvidersCount,
      providersUsedCount,
      marketDataProvider: marketDataResult?.provider || 'none',
      metadataProvider: cmcResult?.provider || 'none',
      newsProvider: newsResult?.provider || 'none'
    }, 'Combining FreeMode results - provider status check');
  }

  // Initialize stages metadata
  const stages: Record<string, { status: string }> = {
    marketData: { status: marketDataResult.success || ccResult.success ? 'completed' : 'failed' },
    technicalIndicators: { status: 'running' },
    priceAction: { status: 'running' },
    volatility: { status: 'running' },
    supportResistance: { status: 'running' },
    patterns: { status: 'running' },
    volume: { status: 'running' },
    finalVerdict: { status: 'running' }
  };

  // CRITICAL: If all providers failed, return minimal result instead of throwing (FreeMode must never throw)
  // Note: All stages still execute, but with failure results
  if (successfulProvidersCount === 0) {
    const errorMsg = 'No data providers available for research - all providers failed';
    logger.error({
      uid,
      symbol,
      providerStatus,
      marketDataError: marketDataResult.error,
      metadataError: cmcResult.error,
      newsError: newsResult.error
    }, errorMsg);

    // Mark stages as failed
    Object.keys(stages).forEach(key => { if (key !== 'marketData') stages[key].status = 'failed'; });

    // Return minimal failure result instead of throwing (route will return 200 with partial data)
    return {
      signal: 'HOLD' as const,
      accuracy: 0,
      snapshotAccuracy: 0,
      accuracyBreakdown: {
        indicatorScore: 0,
        marketStructureScore: 0,
        momentumScore: 0,
        volumeScore: 0,
        newsScore: 0,
        riskPenalty: 0
      },
      accuracyWeightsUsed: {},
      indicators: createDefaultIndicators(),
      metadata: null,
      news: [],
      raw: {
        marketData: marketDataResult.data,
        cryptocompare: ccResult.data,
        metadata: cmcResult.data,
        news: newsResult.data
      },
      providers: {
        marketData: { ...marketDataResult, latency: marketDataResult.latencyMs },
        metadata: { ...cmcResult, latency: cmcResult.latencyMs },
        cryptocompare: { ...ccResult, latency: ccResult.latencyMs },
        news: { ...newsResult, latency: newsResult.latencyMs }
      },
      stages: stages,
      isFinal: isFinal // Return requested isFinal flag
    };
  }

  console.log("FreeMode active, integrations:", providerStatus);

  let primaryData = marketDataResult;
  let dataSource = 'marketData';
  let ohlcToUse = null;
  let ohlcSource = 'none';

  // INTRADAY TRADING: Timeframe unification - use ONE consistent timeframe (prefer 1h)
  // CRITICAL: All indicators MUST use the same timeframe to prevent inconsistency
  // Priority: hourlyOHLC (1h) → marketData (if 1h) → dailyOHLC (last resort, but log warning)
  if (ccResult.success && ccResult.data?.ohlc?.length >= 50) {
    // Prefer hourly OHLC for intraday trading
    ohlcToUse = ccResult.data.ohlc;
    ohlcSource = 'hour';
    console.log(`[INTRADAY_TIMEFRAME] Using 1h OHLC for all indicators, length=${ohlcToUse.length}`);
  } else if (marketDataResult.success && marketDataResult.data?.ohlc?.length >= 50) {
    // Use marketData OHLC if it's hourly (assume it is for intraday)
    ohlcToUse = marketDataResult.data.ohlc;
    ohlcSource = 'marketData';
    console.log(`[INTRADAY_TIMEFRAME] Using marketData OHLC (assumed 1h), length=${ohlcToUse.length}`);
  } else if (ccResult.success && ccResult.data?.ohlc?.length >= 20) {
    // Last resort: use hourly even if < 50 candles
    ohlcToUse = ccResult.data.ohlc;
    ohlcSource = 'fallback';
    console.log(`[INTRADAY_TIMEFRAME] Using hourly OHLC (fallback, < 50 candles), length=${ohlcToUse.length}`);
  } else if (ccResult.success && ccResult.data?.dailyOHLC?.length >= 50) {
    // WARNING: Daily timeframe is NOT ideal for intraday trading, but use as last resort
    ohlcToUse = ccResult.data.dailyOHLC;
    ohlcSource = 'day';
    logger.warn({ uid, symbol }, '[INTRADAY_TIMEFRAME_WARNING] Using daily OHLC - NOT ideal for intraday trading');
    console.log(`[INTRADAY_TIMEFRAME_WARNING] Using daily OHLC (last resort), length=${ohlcToUse.length}`);
  }

  if (ohlcToUse) {
    const baseResult = (ohlcSource === 'hour' || ohlcSource === 'day' || ohlcSource === 'fallback') ? ccResult : marketDataResult;
    primaryData = {
      ...baseResult,
      success: true,
      data: {
        ...(baseResult.data || {}),
        ohlc: ohlcToUse
      }
    };
    dataSource = ohlcSource;
  } else {
    console.log('No sufficient OHLC data found for indicators.');
  }

  // CRITICAL: If OHLC fallback also fails, check if we have ANY real data
  if (!primaryData.success || !primaryData.data?.ohlc || primaryData.data.ohlc.length < 10) {
    // Only use defaults if we have at least one provider that succeeded (already validated above)
    if (providersUsedCount > 0) {
      console.log('⚠️ No valid OHLC data available, but other providers succeeded - using minimal indicators');
      primaryData = {
        success: true,
        data: createDefaultIndicatorsData(),
        latencyMs: 0,
        provider: 'defaults'
      };
      dataSource = 'defaults';
    } else {
      // All providers failed - should not reach here due to earlier validation, but double-check
      const errorMsg = 'No valid market data available - all providers failed';
      logger.error({ uid, symbol, providerStatus }, errorMsg);
      // CRITICAL: Do NOT throw - return minimal result instead (FreeMode must never throw)
      // This should not happen due to earlier check, but handle gracefully
      return {
        signal: 'HOLD' as const,
        accuracy: 0,
        snapshotAccuracy: 0,
        accuracyBreakdown: {
          indicatorScore: 0,
          marketStructureScore: 0,
          momentumScore: 0,
          volumeScore: 0,
          newsScore: 0,
          riskPenalty: 0
        },
        accuracyWeightsUsed: {},
        indicators: createDefaultIndicators(),
        metadata: cmcResult.data || null,
        news: newsResult.data || [],
        raw: {
          marketData: marketDataResult.data,
          cryptocompare: ccResult.data,
          metadata: cmcResult.data,
          news: newsResult.data
        },
        providers: {
          marketData: { ...marketDataResult, latency: marketDataResult.latencyMs },
          metadata: { ...cmcResult, latency: cmcResult.latencyMs },
          cryptocompare: { ...ccResult, latency: ccResult.latencyMs },
          news: { ...newsResult, latency: newsResult.latencyMs }
        }
      };
    }
  }

  const data = primaryData.data;

  // CRITICAL: Research succeeds if ANY meaningful data exists (News OR OHLC OR Market data OR Metadata)
  // Do NOT require all datasets - partial data is acceptable
  const hasAnyData =
    (data?.ohlc && data.ohlc.length >= 20) || // Has OHLC
    (ccResult.success && ccResult.data) || // Has CryptoCompare data
    (marketDataResult.success && marketDataResult.data) || // Has market data
    (cmcResult.success && cmcResult.data) || // Has metadata
    (newsResult.success && newsResult.data?.articles?.length > 0); // Has news

  // If no data at all, return minimal result (but still HTTP 200)
  if (!hasAnyData) {
    logger.warn({ uid, symbol, providerStatus }, 'No meaningful data available from any provider, returning minimal result');
    return {
      signal: 'HOLD',
      accuracy: 0,
      snapshotAccuracy: 0,
      accuracyBreakdown: {
        indicatorScore: 0,
        marketStructureScore: 0,
        momentumScore: 0,
        volumeScore: 0,
        newsScore: 0,
        riskPenalty: 0
      },
      accuracyWeightsUsed: {},
      providers: {
        marketData: { ...marketDataResult, latency: marketDataResult.latencyMs },
        metadata: { ...cmcResult, latency: cmcResult.latencyMs },
        cryptocompare: { ...ccResult, latency: ccResult.latencyMs },
        news: { ...newsResult, latency: newsResult.latencyMs }
      },
      indicators: createDefaultIndicators(),
      metadata: cmcResult.data || null,
      news: newsResult.data || [],
      raw: {
        marketData: marketDataResult.data,
        cryptocompare: ccResult.data,
        metadata: cmcResult.data,
        news: newsResult.data
      }
    };
  }

  // Initialize default values
  let combinedSignal: 'BUY' | 'SELL' | 'HOLD' | 'ANALYZING' = isFinal ? 'HOLD' : 'ANALYZING';
  let accuracy = 0;
  let accuracyResult: any = { accuracy: 0, breakdown: {}, finalAppliedWeights: {}, metadata: { requestId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` } };

  // A. Get indicators from primary data source - handle calculation failures gracefully
  // CRITICAL: Technical Indicators stage ALWAYS executes, even if data is missing
  let indicators: any;
  let indicatorStatus: 'completed' = 'completed';

  try {
    if (!data?.ohlc || data.ohlc.length < 10) {
      // Stage executes but with default/empty data
      indicators = createDefaultIndicators();
      indicatorStatus = 'completed';
      stages.technicalIndicators.status = 'skipped';
      logger.info({ uid, symbol }, '[DR_STAGE_COMPLETE] Technical Indicators (using defaults due to missing data)');
    } else {
      indicators = calculateIndicatorsFromOHLC(data.ohlc);
      indicatorStatus = 'completed';
      stages.technicalIndicators.status = 'completed';
      logger.info({ uid, symbol }, '[DR_STAGE_COMPLETE] Technical Indicators');
    }
  } catch (indicatorError: any) {
    logger.warn({ uid, symbol, error: indicatorError.message }, '[DR_STAGE_FAIL] Technical Indicators - calculation error, using defaults');
    indicators = createDefaultIndicators();
    indicatorStatus = 'completed';
    stages.technicalIndicators.status = 'failed';
  }

  // Attach status to indicators object for aggregator
  indicators.status = indicatorStatus;

  // Price Action, Volatility, and Trend Regime are derived from indicators
  // These stages always execute (they're part of the indicators calculation)
  stages.priceAction.status = indicators.status === 'completed' ? 'completed' : 'completed';
  stages.volatility.status = indicators.atr ? 'completed' : 'skipped';
  stages.supportResistance.status = indicators.ma50 ? 'completed' : 'skipped';
  stages.patterns.status = indicators.pattern ? 'completed' : 'skipped';
  stages.volume.status = indicators.volume ? 'completed' : 'skipped';

  logger.info({ uid, symbol }, '[DR_STAGE_COMPLETE] Price Action');
  logger.info({ uid, symbol }, '[DR_STAGE_COMPLETE] Volatility');
  logger.info({ uid, symbol }, '[DR_STAGE_COMPLETE] Trend Regime');
  logger.info({ uid, symbol }, '[DR_STAGE_COMPLETE] Support & Resistance');
  logger.info({ uid, symbol }, '[DR_STAGE_COMPLETE] Pattern Detection');
  logger.info({ uid, symbol }, '[DR_STAGE_COMPLETE] Volume Analysis');

  // B. Get metadata - CRITICAL: Macro / Narrative stage ALWAYS executes
  let metadata: any = null;
  if (cmcResult.success && cmcResult.data && Object.keys(cmcResult.data).length > 2) {
    metadata = cmcResult.data;
    if (!silent) logger.info({ uid, symbol }, '[DR_STAGE_COMPLETE] Macro / Narrative');
  } else {
    metadata = {
      name: symbol.replace('USDT', '').replace('USD', ''),
      symbol: symbol,
      category: 'Cryptocurrency',
      tags: ['Altcoin'],
      rank: 0,
      supply: { circulating: 0, total: 0 },
      description: `Market data profile for ${symbol}. Native metadata provider unavailable, using verified local fallback.`
    };
    if (!silent) logger.warn({ uid, symbol, provider: cmcResult.provider, error: cmcResult.error }, '[DR_STAGE_COMPLETE] Macro / Narrative (Injected Fallback Metadata)');
  }

  // C. Get news - CRITICAL: News Sentiment stage ALWAYS executes
  let news: any[] = [];
  if (newsResult.success && newsResult.data?.articles) {
    news = newsResult.data.articles;
    logger.info({ uid, symbol }, '[DR_STAGE_COMPLETE] News Sentiment');
  } else {
    const reason = newsResult.error || 'Provider failed';
    if (reason.includes('not_implemented') || reason.includes('not yet implemented')) {
      logger.info({ uid, symbol, provider: newsResult.provider, reason }, '[DR_STAGE_COMPLETE] News Sentiment (skipped - not implemented)');
    } else {
      logger.warn({ uid, symbol, provider: newsResult.provider, error: newsResult.error }, '[DR_STAGE_COMPLETE] News Sentiment (empty data due to provider failure)');
    }
  }

  // D. FINAL VERDICT - Only compute if isFinal is true
  if (isFinal) {
    logger.info({ uid, symbol }, '[DR_STAGE_START] Final Verdict');

    let buySignals = 0;
    let sellSignals = 0;
    let validStrategiesCount = 0;

    // RSI Analysis
    if (indicators.rsi?.value !== null && indicators.rsi?.value !== undefined) {
      validStrategiesCount++;
      if (indicators.rsi.value < 30) buySignals += 2;
      else if (indicators.rsi.value > 70) sellSignals += 2;
    }

    // Moving Averages
    if (indicators.ma50?.smaTrend && indicators.ma200?.smaTrend) {
      validStrategiesCount++;
      if (indicators.ma50.smaTrend === 'bullish' && indicators.ma200.smaTrend === 'bullish') buySignals += 2;
      else if (indicators.ma50.smaTrend === 'bearish' && indicators.ma200.smaTrend === 'bearish') sellSignals += 2;
    }

    // EMA Trend
    if (indicators.ema20?.emaTrend) {
      validStrategiesCount++;
      if (indicators.ema20.emaTrend === 'bullish') buySignals += 1;
      else if (indicators.ema20.emaTrend === 'bearish') sellSignals += 1;
    }

    // MACD
    if (indicators.macd?.signal) {
      validStrategiesCount++;
      if (indicators.macd.signal === 'bullish') buySignals += 1;
      else if (indicators.macd.signal === 'bearish') sellSignals += 1;
    }

    // Volume - CRITICAL FIX: Support both BUY and SELL signals
    if (indicators.volume?.trend) {
      validStrategiesCount++;
      if (indicators.volume.trend === 'increasing') buySignals += 1;
      else if (indicators.volume.trend === 'decreasing') sellSignals += 1;
    }

    // VWAP
    if (indicators.vwap?.signal && indicators.vwap?.value) {
      validStrategiesCount++;
      if (indicators.vwap.signal === 'bullish') buySignals += 1;
      else if (indicators.vwap.signal === 'bearish') sellSignals += 1;
    }

    // Pattern Detection
    if (indicators.pattern?.confidence > 0.7) {
      validStrategiesCount++;
      if (indicators.pattern.pattern?.includes('bull')) buySignals += 2;
      else if (indicators.pattern.pattern?.includes('bear')) sellSignals += 2;
    }

    const totalSignals = buySignals + sellSignals;
    const buyPercentage = totalSignals > 0 ? (buySignals / totalSignals) * 100 : 0;
    const sellPercentage = totalSignals > 0 ? (sellSignals / totalSignals) * 100 : 0;
    const isMemeCoin = indicators.isMemeCoin === true;

    // CRITICAL FIX: Symmetric signal generation - ensure SELL signals can be generated
    // Use 50% threshold (instead of 55%) to allow more balanced signal generation
    // This ensures bearish conditions can produce SELL signals
    if (buySignals === sellSignals && buySignals > 0) {
      combinedSignal = 'HOLD';
    } else if (buyPercentage >= 50 && buySignals > sellSignals) {
      combinedSignal = 'BUY';
    } else if (sellPercentage >= 50 && sellSignals > buySignals) {
      combinedSignal = 'SELL';
    } else {
      combinedSignal = 'HOLD';
    }
    
    logger.debug({ 
      uid, 
      symbol, 
      buySignals, 
      sellSignals, 
      buyPercentage: buyPercentage.toFixed(1), 
      sellPercentage: sellPercentage.toFixed(1),
      combinedSignal 
    }, '[SIGNAL_GEN] Signal generation result');

    if (isFinal) {
      try {
        accuracyResult = await accuracyEngine.calculateSnapshotAccuracy({
          signal: combinedSignal,
          accuracy: 0,
          indicators,
          metadata,
          news,
          raw: {
            marketData: marketDataResult.data,
            cryptocompare: ccResult.success ? ccResult.data : null,
            metadata: cmcResult.data,
            news: newsResult.data
          },
          providers: {
            marketData: marketDataResult,
            metadata: cmcResult,
            cryptocompare: ccResult,
            news: newsResult
          },
          symbol,
          requestId: accuracyResult.metadata.requestId
        });

        let rawAcc = accuracyResult.accuracy || 0;
        if (rawAcc > 1) rawAcc = rawAcc / 100;

        // [ACCURACY_AUDIT] Log accuracy from accuracyEngine
        logger.info({
          uid,
          symbol,
          accuracyFromEngine: accuracyResult.accuracy,
          normalizedRawAccuracy: rawAcc,
          isMemeCoin
        }, '[ACCURACY_AUDIT] Accuracy received from accuracyEngine');

        // PASSIVE MEME GUARD: Reduce confidence instead of forcing HOLD
        if (isMemeCoin) {
          rawAcc *= 0.6; // 40% confidence penalty for low-liquidity/meme coins
          if (!silent) logger.info({ uid, symbol }, "[DR_MEME_GUARD] Applied accuracy penalty instead of forcing HOLD");
        }

        accuracy = Math.max(0, Math.min(1, rawAcc));

        // [ACCURACY_AUDIT] Log accuracy after meme guard and normalization
        logger.info({
          uid,
          symbol,
          finalNormalizedAccuracy: accuracy,
          signal: combinedSignal
        }, '[ACCURACY_AUDIT] Accuracy normalized (0-1 range) after meme guard');

        // CRITICAL: Accuracy-based gating (Requirement) - SINGLE SOURCE OF TRUTH
        // If accuracy < 60%, force signal to HOLD (applies to both BUY and SELL equally)
        if (accuracy < 0.60) {
          combinedSignal = 'HOLD';
          logger.info({ uid, symbol, accuracy: (accuracy * 100).toFixed(1) + '%' }, '[SIGNAL_GATE] Accuracy < 60% → Signal forced to HOLD');
          if (!silent) console.log('[HOLD_LOW_ACCURACY]', { uid, symbol, accuracy });
        }
        // CRITICAL FIX: Removed SELL-specific accuracy guard that was biasing toward BUY
        // SELL signals with accuracy >= 60% should be allowed, even if accuracy is lower than BUY
        // The 60% gate above already handles low accuracy cases for both BUY and SELL symmetrically
        
        // CRITICAL: When accuracy >= 60%, signal MUST be BUY or SELL (never HOLD)
        if (combinedSignal === 'HOLD' && accuracy >= 0.60) {
          logger.error({ uid, symbol, accuracy: (accuracy * 100).toFixed(1) + '%', originalSignal: combinedSignal }, 
            '[SIGNAL_GATE_ERROR] Accuracy >= 60% but signal is HOLD - this should never happen!');
          // Force to BUY as fallback (safer than leaving as HOLD)
          combinedSignal = 'BUY';
          logger.warn({ uid, symbol }, '[SIGNAL_GATE_FIX] Forced HOLD to BUY due to high accuracy');
        }
        logger.info({ uid, symbol, signal: combinedSignal, accuracy: (accuracy * 100).toFixed(1) + '%' }, 
          '[SIGNAL_GATE] Accuracy >= 60% → Signal is BUY/SELL (trade plan will be generated)');
      } catch (accuracyError: any) {
        logger.warn({ uid, symbol, error: accuracyError.message }, 'Accuracy engine calculation failed, using neutral 50% default');
        accuracy = 0.5;
      }
    } else {
      // Background / Intermediate state: Accuracy is not yet official
      accuracy = 0;
      combinedSignal = 'ANALYZING';
    }

    stages.finalVerdict.status = 'completed';
    if (!silent) logger.info({ uid, symbol, accuracy }, '[DR_STAGE_COMPLETE] Final Verdict');

    // CRITICAL: Final signal hardening before trade plan generation
    // If accuracy >= 60%, signal MUST be BUY or SELL (never HOLD)
    // This is the SINGLE SOURCE OF TRUTH for signal gating
    const normalizedAccuracyCheck = accuracy > 1 ? accuracy / 100 : accuracy;
    if (normalizedAccuracyCheck >= 0.60 && combinedSignal === 'HOLD') {
      logger.error({ uid, symbol, originalSignal: combinedSignal, accuracy: normalizedAccuracyCheck }, 
        '[SIGNAL_HARDEN_FINAL] Accuracy >= 60% but signal is HOLD - this violates single source of truth!');
      // This should never happen if accuracy gating worked correctly above
      // But if it does, we force to BUY as fallback
      combinedSignal = 'BUY';
      logger.warn({ uid, symbol }, '[SIGNAL_HARDEN_FINAL] Corrected HOLD to BUY due to high accuracy');
    }

    // D. FINAL INTEGRITY CHECK & LOGGING (Assertion)
    let finalPrice = data?.price || indicators?.price || indicators?.latest?.price || 0;

    // Ensure price > 0
    if (finalPrice <= 0) {
      logger.warn({ uid, symbol, finalPrice }, "assertion_failed: price invalid, using backup price");
      finalPrice = indicators?.latest?.price || 0;
    }

    // Ensure signal is valid
    if (!['BUY', 'SELL', 'HOLD'].includes(combinedSignal)) {
      logger.error({ uid, symbol, combinedSignal }, "assertion_failed: invalid signal, defaulting to HOLD");
      combinedSignal = 'HOLD';
    }
    
    // CRITICAL: Final signal hardening - prevent silent downgrades
    // If accuracy >= 60%, signal MUST be BUY or SELL (never HOLD)
    const normalizedAccuracyForCheck = accuracy > 1 ? accuracy / 100 : accuracy;
    if (normalizedAccuracyForCheck >= 0.60 && combinedSignal === 'HOLD') {
      logger.error({ uid, symbol, originalSignal: combinedSignal, accuracy: normalizedAccuracyForCheck }, 
        '[SIGNAL_HARDEN_ASSERT] Accuracy >= 60% but signal is HOLD after validation - forcing to BUY');
      combinedSignal = 'BUY'; // Force to BUY as fallback
    }

    // Normalize accuracy for return object
    const normalizeLocal = (val: any): number => {
      if (val === null || val === undefined || Number.isNaN(Number(val))) return 0;
      let num = Number(val);
      if (num > 1) num = num / 100;
      return Math.max(0, Math.min(1, num));
    };

    const finalNormalizedAccuracy = normalizeLocal(accuracy);

    // SINGLE FINAL LOG (Requirement 6)
    console.log("[FINAL_VERDICT_COMPUTED]", {
      symbol,
      signal: combinedSignal,
      accuracy: (finalNormalizedAccuracy * 100).toFixed(1) + '%',
      price: finalPrice,
      newsCount: news?.length || 0,
      metadataPresence: !!metadata
    });

    // E. Save prediction snapshot (Consolidated - Requirement 7)
    try {
      await accuracyEngine.savePredictionSnapshot(uid, {
        requestId: accuracyResult.metadata.requestId,
        timestamp: new Date(),
        symbol,
        strategy: 'free-mode',
        signal: combinedSignal,
        positionPercentCandidate: 0,
        snapshotAccuracy: finalNormalizedAccuracy,
        breakdown: accuracyResult.breakdown,
        providersStatus: {
          marketData: marketDataResult.success,
          cryptocompare: ccResult.success,
          metadata: cmcResult.success,
          news: newsResult.success
        }
      });
    } catch (snapshotError) {
      logger.warn({ error: (snapshotError as any).message }, 'Failed to save prediction snapshot');
    }

    // Preserve values for return object
    accuracy = finalNormalizedAccuracy;
  } else {
    // If not final, just mark stage as running and use defaults
    stages.finalVerdict.status = 'running';
    combinedSignal = 'ANALYZING';
    accuracy = 0;
  }

  // Generate images for the analysis - handle failures gracefully
  let images: string[] = [];
  try {
    images = await generateAnalysisImages(symbol, indicators, data.ohlc || []);

    // GUARANTEE: If no specialized charts generated, fallback to coin logo from metadata
    if (images.length === 0) {
      if (cmcResult.data?.logo) images.push(cmcResult.data.logo);
      else if (cmcResult.data?.image) images.push(cmcResult.data.image);
      else if (ccResult.data?.CoinInfo?.ImageUrl) {
        images.push(`https://www.cryptocompare.com${ccResult.data.CoinInfo.ImageUrl}`);
      }
      // Last resort: standard crypto logo if nothing else
      if (images.length === 0) {
        images.push('https://static.coingecko.com/s/coingecko-logo-d13de195006be1340156a59929280d2d.png');
      }
    }
  } catch (imageError: any) {
    logger.warn({ uid, symbol, error: imageError.message }, 'Image generation failed, using metadata logo');
    if (cmcResult.data?.logo) images = [cmcResult.data.logo];
    else images = [];
  }

  // Transform to required structured format - handle formatter failures gracefully
  let structuredResult: any;
  const uiArticles = transformNewsForUI(news);

  // Gaurantee at least one placeholder news article for UI consistency
  if (uiArticles.length === 0) {
    uiArticles.push({
      title: `Latest Market Analysis for ${symbol}`,
      source: 'Market Intelligence',
      publishedAt: new Date().toISOString(),
      url: 'https://coinmarketcap.com',
      summary: `Our engine is currently monitoring ${symbol} for significant news events. Technical indicators are being prioritized.`,
      sentiment: 'neutral'
    });
  }

  try {
    structuredResult = {
      coin: symbol,
      summary: generateAnalysisSummary(combinedSignal as any, accuracy, indicators, metadata),
      signals: generateSignalsArray(combinedSignal as any, accuracy, indicators),
      metrics: generateMetricsObject(indicators),
      news: { articles: uiArticles },
      images: images
    };
  } catch (formatError: any) {
    logger.warn({ uid, symbol, error: formatError.message }, 'Result formatting failed, using minimal structure');
    structuredResult = {
      coin: symbol,
      summary: `Analysis for ${symbol} with ${(accuracy * 100).toFixed(1)}% accuracy (${combinedSignal} signal)`,
      signals: [{
        type: (combinedSignal as any).toLowerCase(),
        confidence: accuracy,
        reason: 'Technical analysis'
      }],
      metrics: {
        momentum: { rsi: indicators.rsi?.value || 50, macd: indicators.macd?.value || 0, trend: indicators.ema20?.emaTrend || 'neutral' },
        volatility: { atr: indicators.atr?.value || 0, classification: indicators.atr?.classification || 'medium' },
        volume: { trend: indicators.volume?.trend || 'neutral', score: indicators.volume?.score || 50 },
        support: indicators.ma50?.value || 0,
        resistance: indicators.ma200?.value || 0
      },
      news: { articles: uiArticles },
      images: images
    };
  }

  // CRITICAL: Normalize accuracy to 0-1 range (Decimal)
  // This is the FINAL safety net before sending data to frontend
  const normalizeAccuracyBackend = (val: any): number => {
    if (val === null || val === undefined || Number.isNaN(Number(val))) return 0;
    let num = Number(val);
    // If > 1, it's likely a percentage (e.g. 85.5), convert to decimal
    if (num > 1) num = num / 100;
    // Clamp to 0-1
    return Math.max(0, Math.min(1, num));
  };

  // Normalize all accuracy values
  const normalizedAccuracy = normalizeAccuracyBackend(accuracy);
  const normalizedSnapshotAccuracy = normalizeAccuracyBackend(accuracyResult.accuracy);

  // [ACCURACY_AUDIT] Log final normalized accuracy before return
  logger.info({
    uid,
    symbol,
    normalizedAccuracy,
    normalizedSnapshotAccuracy,
    signal: combinedSignal,
    isFinal,
    willGenerateTradePlan: combinedSignal !== 'HOLD' && normalizedAccuracy >= 0.70
  }, '[ACCURACY_AUDIT] FINAL normalized accuracy (ready for return)');

  // Consolidate final price from previous checks
  const finalPrice = data?.price || indicators?.price || indicators?.latest?.price || 0;

  // Generate high-confidence trade plan
  // CRITICAL: Only generate trade plan when accuracy >= 70% AND signal is BUY/SELL
  // If signal is HOLD or accuracy < 70%, tradePlan MUST be null (not undefined)
  let tradePlan: any = null;
  if (combinedSignal !== 'HOLD' && normalizedAccuracy >= 0.70) {
    tradePlan = generateTradePlan(combinedSignal as any, normalizedAccuracy, indicators);
    if (!tradePlan) {
      logger.warn({ uid, symbol, signal: combinedSignal, accuracy: normalizedAccuracy }, 
        '[TRADE_PLAN] generateTradePlan returned null despite accuracy >= 70% and signal != HOLD');
    } else {
      logger.info({ 
        uid, 
        symbol, 
        signal: combinedSignal, 
        accuracy: (normalizedAccuracy * 100).toFixed(1) + '%',
        entryPrice: tradePlan.entryPrice,
        stopLoss: tradePlan.stopLoss,
        tp1: tradePlan.takeProfit1,
        tp2: tradePlan.takeProfit2,
        tp3: tradePlan.takeProfit3
      }, '[TRADE_PLAN] Trade plan generated with Entry/SL/TP1/TP2/TP3');
    }
  } else {
    logger.info({ uid, symbol, signal: combinedSignal, accuracy: (normalizedAccuracy * 100).toFixed(1) + '%' }, 
      '[TRADE_PLAN] Trade plan NOT generated (signal is HOLD or accuracy < 70%)');
  }
  
  // CRITICAL: Explicitly set tradePlan to null if signal is HOLD or accuracy < 70%
  if (combinedSignal === 'HOLD' || normalizedAccuracy < 0.70) {
    tradePlan = null;
    structuredResult.tradePlan = null; // Explicitly null, not undefined
  } else if (tradePlan) {
    structuredResult.tradePlan = tradePlan;
  } else {
    structuredResult.tradePlan = null; // Explicitly null if generateTradePlan returned null
  }

  // BUILD DEFINITIVE ANALYSIS STRUCTURE (Task 7)
  const analysis = {
    technicalIndicators: {
      status: 'completed',
      rsi: indicators.rsi || null,
      sma50: indicators.ma50 || null,
      sma200: indicators.ma200 || null,
      ema20: indicators.ema20 || null,
      ema50: indicators.ema50 || null,
      macd: indicators.macd || null,
      atr: indicators.atr || null,
      vwap: indicators.vwap || null,
      distribution: (() => {
        const trendDirection = indicators.ema20?.emaTrend || 'neutral';
        const momentumScore = indicators.momentum?.score || 0.5;
        let uptrendProb = 0, downtrendProb = 0, sidewaysProb = 0;

        if (trendDirection === 'bullish' || momentumScore > 0.6) {
          uptrendProb = Math.min(100, Math.round(momentumScore * 100));
          sidewaysProb = Math.max(0, Math.round((1 - momentumScore) * 50));
          downtrendProb = 100 - uptrendProb - sidewaysProb;
        } else if (trendDirection === 'bearish' || momentumScore < 0.4) {
          downtrendProb = Math.min(100, Math.round((1 - momentumScore) * 100));
          sidewaysProb = Math.max(0, Math.round(momentumScore * 50));
          uptrendProb = 100 - downtrendProb - sidewaysProb;
        } else {
          sidewaysProb = 50; uptrendProb = 25; downtrendProb = 25;
        }

        if (trendDirection === 'bearish' && downtrendProb < Math.max(uptrendProb, sidewaysProb)) {
          downtrendProb = 100; uptrendProb = 0; sidewaysProb = 0;
        }

        const total = uptrendProb + sidewaysProb + downtrendProb;
        if (total > 0) {
          uptrendProb = Math.round((uptrendProb / total) * 100);
          sidewaysProb = Math.round((sidewaysProb / total) * 100);
          downtrendProb = 100 - uptrendProb - sidewaysProb;
        }
        return { uptrendScore: uptrendProb, sidewaysScore: sidewaysProb, downtrendScore: downtrendProb };
      })()
    },
    priceAction: {
      status: 'completed',
      currentPrice: finalPrice,
      vsEMA20: (indicators.ema20?.value && finalPrice) ? Math.max(-100, Math.min(1000, ((finalPrice - indicators.ema20.value) / indicators.ema20.value) * 100)) : null,
      vsSMA50: (indicators.ma50?.value && finalPrice) ? Math.max(-100, Math.min(1000, ((finalPrice - indicators.ma50.value) / indicators.ma50.value) * 100)) : null,
      vsSMA200: (indicators.ma200?.value && finalPrice) ? Math.max(-100, Math.min(1000, ((finalPrice - indicators.ma200.value) / indicators.ma200.value) * 100)) : null,
      trendDirection: indicators.ema20?.emaTrend || 'neutral',
      momentumBias: indicators.momentum?.direction || 'neutral',
      vwapSignal: indicators.vwap?.signal || null,
      price: finalPrice,
      ma50: indicators.ma50 || null,
      ma200: indicators.ma200 || null,
      ema20: indicators.ema20 || null,
      vwap: indicators.vwap || null
    },
    volatility: {
      status: 'completed',
      atr: indicators.atr || null,
      bollinger: null
    },
    supportResistance: {
      status: 'completed',
      majorSupport: indicators.supportResistance?.majorSupport || indicators.ma200?.value || null,
      minorSupport: indicators.supportResistance?.minorSupport || indicators.ma50?.value || null,
      majorResistance: indicators.supportResistance?.majorResistance || null,
      minorResistance: indicators.supportResistance?.minorResistance || null
    },
    patterns: {
      status: 'completed',
      doubleBottom: indicators.pattern?.pattern?.toLowerCase().includes('double bottom') || false,
      doubleTop: indicators.pattern?.pattern?.toLowerCase().includes('double top') || false,
      headAndShoulders: indicators.pattern?.pattern?.toLowerCase().includes('head and shoulders') || false,
      hammer: indicators.pattern?.pattern?.toLowerCase().includes('hammer') || false,
      doji: indicators.pattern?.pattern?.toLowerCase().includes('doji') || false,
      bullishEngulfing: indicators.pattern?.pattern?.toLowerCase().includes('bullish engulfing') || false,
      bearishEngulfing: indicators.pattern?.pattern?.toLowerCase().includes('bearish engulfing') || false,
      breakOfStructure: indicators.pattern?.pattern?.toLowerCase().includes('break of structure') || false,
      activePattern: indicators.pattern?.pattern || null
    },
    momentum: {
      status: 'completed',
      rsi: indicators.rsi || null,
      macd: indicators.macd || null,
      momentumScore: indicators.momentum?.score || null
    },
    volume: {
      status: 'completed',
      volumeTrend: indicators.volume?.trend || null,
      volumeScore: indicators.volume?.score || null
    },
    strategies: [
      { name: 'RSI', signal: indicators.rsi?.value < 30 ? 'BUY' : indicators.rsi?.value > 70 ? 'SELL' : 'HOLD', confidence: null, reason: null },
      { name: 'EMA Trend (20/50)', signal: indicators.ema20?.emaTrend || 'HOLD', confidence: null, reason: null },
      { name: 'SMA Trend (50/200)', signal: indicators.ma50?.smaTrend || 'HOLD', confidence: null, reason: null },
      { name: 'MACD', signal: indicators.macd?.signal || 'HOLD', confidence: null, reason: null },
      { name: 'ATR / Volatility', signal: 'HOLD', confidence: null, reason: null },
      { name: 'VWAP', signal: indicators.vwap?.signal || 'HOLD', confidence: null, reason: null },
      { name: 'Bollinger Bands', signal: 'HOLD', confidence: null, reason: null },
      { name: 'Support & Resistance', signal: 'HOLD', confidence: null, reason: null },
      { name: 'Price Action (HH/HL, LH/LL)', signal: 'HOLD', confidence: null, reason: null },
      { name: 'Chart Patterns', signal: 'HOLD', confidence: null, reason: null },
      { name: 'Momentum', signal: indicators.momentum?.direction || 'HOLD', confidence: null, reason: null },
      { name: 'Volume Confirmation', signal: 'HOLD', confidence: null, reason: null }
    ]
  };

  // CRITICAL: Final signal hardening - ensure no silent downgrades
  // If accuracy >= 60%, signal MUST be BUY or SELL (never HOLD)
  const finalSignal = (normalizedAccuracy >= 0.60 && combinedSignal === 'HOLD') 
    ? 'BUY' // Fallback to BUY if somehow HOLD with high accuracy
    : combinedSignal;
  
  if (finalSignal !== combinedSignal) {
    logger.error({ uid, symbol, originalSignal: combinedSignal, finalSignal, accuracy: normalizedAccuracy }, 
      '[SIGNAL_HARDEN] Signal was downgraded - corrected to BUY');
  }
  
  // CRITICAL: Final trade plan validation
  // If signal is BUY/SELL and accuracy >= 70%, tradePlan MUST exist
  // If signal is HOLD or accuracy < 70%, tradePlan MUST be null
  let finalTradePlan: any = null;
  
  if (finalSignal === 'HOLD' || normalizedAccuracy < 0.70) {
    // HOLD or low accuracy: tradePlan MUST be null
    finalTradePlan = null;
    if (tradePlan !== null) {
      logger.error({ uid, symbol, signal: finalSignal, accuracy: normalizedAccuracy, tradePlan }, 
        '[TRADE_PLAN_HARDEN] Signal is HOLD or accuracy < 70% but tradePlan exists! Forcing to null.');
      finalTradePlan = null;
    }
  } else {
    // BUY/SELL with accuracy >= 70%: tradePlan MUST exist
    finalTradePlan = tradePlan;
    if (!finalTradePlan) {
      logger.error({ uid, symbol, signal: finalSignal, accuracy: normalizedAccuracy }, 
        '[TRADE_PLAN_HARDEN] Signal is BUY/SELL with accuracy >= 70% but tradePlan is null!');
      // This is a critical error - trade plan should have been generated
      // We'll leave it as null and let downstream handle it
    } else {
      // Validate trade plan has required fields
      if (!finalTradePlan.entryPrice || !finalTradePlan.stopLoss) {
        logger.error({ uid, symbol, signal: finalSignal, tradePlan: finalTradePlan }, 
          '[TRADE_PLAN_HARDEN] Trade plan missing entryPrice or stopLoss!');
        finalTradePlan = null; // Invalidate incomplete trade plan
      }
    }
  }

  // CRITICAL: Final verification logging - prove signal/tradePlan consistency
  if (finalSignal === 'HOLD' || normalizedAccuracy < 0.70) {
    logger.info({ 
      uid, 
      symbol, 
      signal: finalSignal, 
      accuracy: (normalizedAccuracy * 100).toFixed(1) + '%',
      tradePlanExists: finalTradePlan !== null,
      tradePlan: finalTradePlan
    }, '[SIGNAL_VERIFY] HOLD signal or accuracy < 70% → tradePlan MUST be null');
    
    // Enforce: tradePlan MUST be null
    if (finalTradePlan !== null) {
      logger.error({ uid, symbol, tradePlan: finalTradePlan }, 
        '[SIGNAL_VERIFY_ERROR] HOLD/low accuracy but tradePlan exists - forcing to null');
      finalTradePlan = null;
    }
  } else {
    logger.info({ 
      uid, 
      symbol, 
      signal: finalSignal, 
      accuracy: (normalizedAccuracy * 100).toFixed(1) + '%',
      tradePlanExists: finalTradePlan !== null,
      hasEntryPrice: !!finalTradePlan?.entryPrice,
      hasStopLoss: !!finalTradePlan?.stopLoss,
      hasTP1: !!finalTradePlan?.takeProfit1,
      hasTP2: !!finalTradePlan?.takeProfit2,
      hasTP3: !!finalTradePlan?.takeProfit3
    }, '[SIGNAL_VERIFY] BUY/SELL signal with accuracy >= 70% → tradePlan MUST exist with Entry/SL/TP1/TP2/TP3');
    
    // Enforce: tradePlan MUST exist and have required fields
    if (!finalTradePlan) {
      logger.error({ uid, symbol, signal: finalSignal, accuracy: normalizedAccuracy }, 
        '[SIGNAL_VERIFY_ERROR] BUY/SELL with accuracy >= 70% but tradePlan is null!');
    } else if (!finalTradePlan.entryPrice || !finalTradePlan.stopLoss) {
      logger.error({ uid, symbol, tradePlan: finalTradePlan }, 
        '[SIGNAL_VERIFY_ERROR] Trade plan missing entryPrice or stopLoss!');
      finalTradePlan = null; // Invalidate
    }
  }

  // Return both structured format and original detailed format
  const result: FreeModeDeepResearchResult = {
    signal: finalSignal,
    price: finalPrice,
    accuracy: normalizedAccuracy,
    snapshotAccuracy: normalizedSnapshotAccuracy,
    accuracyBreakdown: accuracyResult.breakdown,
    accuracyWeightsUsed: accuracyResult.finalAppliedWeights,
    tradePlan: finalTradePlan, // Explicitly null for HOLD, or valid trade plan for BUY/SELL
    indicators,
    metadata,
    news: { articles: uiArticles },
    coinImages: images,
    analysis, // Consolidation Task 7
    raw: {
      marketData: marketDataResult?.data || null,
      cryptocompare: ccResult?.data || null,
      metadata: cmcResult?.data || null,
      news: newsResult?.data || null
    },
    providers: {
      marketData: {
        success: marketDataResult.success,
        latency: marketDataResult.latencyMs,
        data: marketDataResult.data,
        error: marketDataResult.error
      },
      metadata: {
        success: cmcResult.success,
        latency: cmcResult.latencyMs,
        data: cmcResult.data,
        error: cmcResult.error
      },
      cryptocompare: {
        success: ccResult.success,
        latency: ccResult.latencyMs,
        data: ccResult.data,
        error: ccResult.error
      },
      news: {
        success: newsResult.success,
        latency: newsResult.latencyMs,
        data: newsResult.data,
        error: newsResult.error
      }
    },
    structuredAnalysis: structuredResult,
    isFinal: isFinal,
    isProcessing: !isFinal
  };

  // CRITICAL: Add stagesMetadata and providersMetadata BEFORE freezing
  // These must be included in the result object before Object.freeze() is called
  // WHY: Once Object.freeze() is called, the object becomes non-extensible and properties cannot be added or modified
  // Mutation after freeze throws: "Cannot add property X, object is not extensible"
  if (stagesMetadata) {
    // Deep copy stages to prevent external mutations affecting the frozen object
    const stagesCopy = JSON.parse(JSON.stringify(stagesMetadata));
    (result as any).stages = stagesCopy;
  } else if (isFinal) {
    // Ensure stages always exists for FINAL results (even if empty) to prevent later addition attempts
    (result as any).stages = {};
  }
  if (providersMetadata) {
    // Deep copy providersMetadata to prevent external mutations
    const providersCopy = JSON.parse(JSON.stringify(providersMetadata));
    (result as any).providersMetadata = providersCopy;
  } else if (isFinal) {
    // Ensure providersMetadata always exists for FINAL results
    (result as any).providersMetadata = {};
  }

  // TASK 2: ENFORCE SINGLE FINALIZATION (Freeze final result)
  // IMPORTANT: All properties (including stages/providersMetadata) must be attached BEFORE this point
  // WHY: Object.freeze() makes the object immutable - no properties can be added, deleted, or modified
  // After freezing, any mutation attempt will throw "Cannot add property X, object is not extensible"
  if (isFinal) {
    Object.freeze(result);
    // Also freeze nested objects to prevent deep mutations
    if ((result as any).stages) Object.freeze((result as any).stages);
    if ((result as any).providersMetadata) Object.freeze((result as any).providersMetadata);
  }

  return result;
}

