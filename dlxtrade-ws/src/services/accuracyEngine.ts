import { firestoreAdapter } from './firestoreAdapter';
import { logger } from '../utils/logger';

// Strategy profiles with weight overrides
const STRATEGY_PROFILES = {
  default: {
    indicators: 0.40,
    marketStructure: 0.25,
    momentum: 0.15,
    volume: 0.10,
    news: 0.10
  },
  scalping: {
    indicators: 0.30,
    marketStructure: 0.20,
    momentum: 0.25,
    volume: 0.15,
    news: 0.10
  },
  swing: {
    indicators: 0.45,
    marketStructure: 0.30,
    momentum: 0.10,
    volume: 0.05,
    news: 0.10
  },
  breakout: {
    indicators: 0.30,
    marketStructure: 0.20,
    momentum: 0.20,
    volume: 0.20,
    news: 0.10
  },
  'trend-follow': {
    indicators: 0.45,
    marketStructure: 0.30,
    momentum: 0.10,
    volume: 0.05,
    news: 0.10
  }
};

export interface AccuracyBreakdown {
  indicatorScore: number;
  marketStructureScore: number;
  momentumScore: number;
  volumeScore: number;
  newsScore: number;
  riskPenalty: number;
}

export interface AccuracyResult {
  accuracy: number;
  breakdown: AccuracyBreakdown;
  finalAppliedWeights: Record<string, number>;
  metadata: {
    symbol: string;
    strategy: string;
    requestId?: string;
  };
}

export interface DeepResearchReport {
  signal: 'BUY' | 'SELL' | 'HOLD';
  accuracy: number;
  indicators: any;
  metadata: any;
  news: any[];
  raw: any;
  providers: any;
  symbol?: string;
  requestId?: string;
}

/**
 * Comprehensive accuracy engine for Deep Research predictions
 * Calculates realistic, data-driven accuracy scores based on multi-factor analysis
 */
export class AccuracyEngine {

  // Stub methods for compatibility with userEngineManager (these don't do anything)
  setAdapter(adapter: any) {}
  setUserId(uid: string) {}
  setOrderManager(orderManager: any) {}
  async start(symbol: string, interval: number) {}
  async stop() {}

  /**
   * Calculate snapshot accuracy for a Deep Research report
   */
  async calculateSnapshotAccuracy(report: DeepResearchReport, strategy?: string): Promise<AccuracyResult> {
    const startTime = Date.now();
    const requestId = report.requestId || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    logger.debug({ requestId, symbol: report.symbol, strategy }, 'Starting accuracy calculation');

    // A) Input validation
    if (!report.indicators || !report.signal || !report.symbol) {
      logger.error({ requestId }, 'Missing required fields for accuracy calculation');
      return {
        accuracy: 0,
        breakdown: {
          indicatorScore: 0,
          marketStructureScore: 0,
          momentumScore: 0,
          volumeScore: 0,
          newsScore: 0,
          riskPenalty: 0
        },
        finalAppliedWeights: STRATEGY_PROFILES.default,
        metadata: {
          symbol: report.symbol || 'UNKNOWN',
          strategy: strategy || 'default',
          requestId
        }
      };
    }

    // B) Get strategy profile
    const profile = STRATEGY_PROFILES[strategy as keyof typeof STRATEGY_PROFILES] || STRATEGY_PROFILES.default;

    // C) Calculate sub-scores
    const indicatorScore = this.calculateIndicatorScore(report, strategy);
    const marketStructureScore = this.calculateMarketStructureScore(report);
    const momentumScore = this.calculateMomentumScore(report);
    const volumeScore = this.calculateVolumeScore(report);
    const newsScore = this.calculateNewsScore(report);
    const riskPenalty = this.calculateRiskPenalty(report);

    // D) Combine with weights
    const finalAccuracyRaw =
      (indicatorScore * profile.indicators) +
      (marketStructureScore * profile.marketStructure) +
      (momentumScore * profile.momentum) +
      (volumeScore * profile.volume) +
      (newsScore * profile.news);

    let finalAccuracy = Math.max(0, Math.min(100, finalAccuracyRaw - riskPenalty));

    // E) Special rules and adjustments
    finalAccuracy = this.applySpecialRules(finalAccuracy, report);

    // Round to 1 decimal place
    finalAccuracy = Math.round(finalAccuracy * 10) / 10;

    const result: AccuracyResult = {
      accuracy: finalAccuracy,
      breakdown: {
        indicatorScore,
        marketStructureScore,
        momentumScore,
        volumeScore,
        newsScore,
        riskPenalty
      },
      finalAppliedWeights: profile,
      metadata: {
        symbol: report.symbol,
        strategy: strategy || 'default',
        requestId
      }
    };

    logger.debug({
      requestId,
      finalAccuracy,
      profile: strategy,
      duration: Date.now() - startTime
    }, 'Accuracy calculation completed');

    return result;
  }

  /**
   * Calculate indicator alignment score (0-100)
   */
  private calculateIndicatorScore(report: DeepResearchReport, strategy?: string): number {
    let score = 50; // Start neutral
    const signal = report.signal;
    const indicators = report.indicators;
    const currentPrice = report.raw?.marketData?.price || indicators?.latest?.price || 0;

    // MACD scoring
    const macdSignal = indicators?.macd?.signal;
    if (macdSignal === 'bullish' && signal === 'BUY') score += 15;
    else if (macdSignal === 'bearish' && signal === 'SELL') score += 15;
    else if (macdSignal === 'bullish' && signal === 'SELL') score -= 12;
    else if (macdSignal === 'bearish' && signal === 'BUY') score -= 12;

    // RSI scoring
    const rsi = indicators?.rsi?.value || 50;
    if (signal === 'BUY') {
      if (rsi < 30) score += 12; // Oversold support
      else if (rsi > 75) score -= 10; // Overbought resistance
      else if (rsi > 60) score += 7; // Neutral-good support
    } else if (signal === 'SELL') {
      if (rsi > 70) score += 12; // Overbought support
      else if (rsi < 25) score -= 10; // Oversold resistance
      else if (rsi < 40) score += 7; // Neutral-good support
    }

    // Price vs Moving Averages
    const ema20 = indicators?.ema20?.value || currentPrice;
    const sma50 = indicators?.ma50?.value || currentPrice;
    const sma200 = indicators?.ma200?.value || currentPrice;

    if (signal === 'BUY') {
      if (currentPrice > ema20 && currentPrice > sma50 && currentPrice > sma200) score += 15;
      else if (currentPrice > ema20 && currentPrice > sma50) score += 8;
      else if (currentPrice < sma200) score -= 15;
    } else if (signal === 'SELL') {
      if (currentPrice < ema20 && currentPrice < sma50 && currentPrice < sma200) score += 15;
      else if (currentPrice < ema20 && currentPrice < sma50) score += 8;
      else if (currentPrice > sma200) score -= 15;
    }

    // VWAP alignment
    const vwap = indicators?.vwap?.value || currentPrice;
    if (signal === 'BUY' && currentPrice > vwap) score += 8;
    else if (signal === 'SELL' && currentPrice < vwap) score += 8;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculate market structure score (0-100)
   */
  private calculateMarketStructureScore(report: DeepResearchReport): number {
    let score = 50; // Start neutral
    const signal = report.signal;
    const ccData = report.raw?.cryptocompare;

    // Trend alignment
    if (ccData?.trend1h) {
      if ((ccData.trend1h === 'bullish' && signal === 'BUY') ||
          (ccData.trend1h === 'bearish' && signal === 'SELL')) {
        score += 15;
      }
    }

    if (ccData?.trend1d) {
      if ((ccData.trend1d === 'bullish' && signal === 'BUY') ||
          (ccData.trend1d === 'bearish' && signal === 'SELL')) {
        score += 15;
      }
    }

    // Market regime (simplified - could be enhanced with actual regime detection)
    const currentPrice = report.raw?.marketData?.price || 0;
    const vwap = report.indicators?.vwap?.value || currentPrice;

    if (signal === 'BUY') {
      if (currentPrice > vwap) score += 20; // Premium zone = bullish regime
      else if (Math.abs(currentPrice - vwap) / vwap < 0.01) score += 10; // Neutral zone
      else score += 0; // Discount zone = bearish regime
    } else if (signal === 'SELL') {
      if (currentPrice < vwap) score += 20; // Discount zone = bearish regime
      else if (Math.abs(currentPrice - vwap) / vwap < 0.01) score += 10; // Neutral zone
      else score += 0; // Premium zone = bullish regime
    }

    // Support/Resistance proximity (simplified)
    const vwapDeviation = report.indicators?.vwap?.deviation || 0;
    if (signal === 'BUY' && vwapDeviation > 1.5) score -= 20; // Near resistance
    else if (signal === 'SELL' && vwapDeviation < -1.5) score -= 20; // Near support

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculate momentum score (0-100)
   */
  private calculateMomentumScore(report: DeepResearchReport): number {
    const momentum = report.indicators?.momentum?.score || 0.5;
    let score = momentum * 100; // Convert 0-1 to 0-100

    // ATR penalty for high volatility
    const atrClassification = report.indicators?.atr?.classification;
    if (atrClassification === 'high') score -= 15;
    else if (atrClassification === 'medium') score -= 7;

    // Pattern confidence bonus
    const patternConfidence = report.indicators?.pattern?.confidence || 0;
    score += patternConfidence * 10; // Up to +10

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculate volume confirmation score (0-100)
   */
  private calculateVolumeScore(report: DeepResearchReport): number {
    const volumeTrend = report.indicators?.volume?.trend || 'neutral';
    const volumeStrength = report.indicators?.volume?.score || 0.5;
    const signal = report.signal;

    // Base score from volume strength
    let score = volumeStrength < 0.3 ? 20 : volumeStrength < 0.7 ? 60 : 100;

    // Direction confirmation bonus
    if ((volumeTrend === 'increasing' && signal === 'BUY') ||
        (volumeTrend === 'decreasing' && signal === 'SELL')) {
      score = Math.min(100, score + 10);
    }

    // Divergence penalty
    if ((volumeTrend === 'decreasing' && signal === 'BUY') ||
        (volumeTrend === 'increasing' && signal === 'SELL')) {
      score = Math.max(0, score - 10);
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculate news and sentiment score (0-100)
   */
  private calculateNewsScore(report: DeepResearchReport): number {
    const news = report.news || [];
    const signal = report.signal;

    if (!report.providers?.news?.success || news.length === 0) {
      return 45; // Reduced score when news unavailable
    }

    // Aggregate sentiment from news
    let totalSentiment = 0;
    let newsCount = 0;

    for (const item of news) {
      if (item.sentiment !== undefined) {
        totalSentiment += item.sentiment;
        newsCount++;
      }
    }

    const avgSentiment = newsCount > 0 ? totalSentiment / newsCount : 0;
    let score = 50 + (avgSentiment * 50); // Convert -1/+1 to 0/100

    // Keyword analysis for high-impact events
    const negativeKeywords = ['hack', 'regulation', 'ban', 'crisis', 'crash', 'scam'];
    const titleText = news.map(n => n.title || '').join(' ').toLowerCase();

    for (const keyword of negativeKeywords) {
      if (titleText.includes(keyword)) {
        score = Math.max(0, score - 25);
        break;
      }
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculate risk/volatility penalty (0-15)
   */
  private calculateRiskPenalty(report: DeepResearchReport): number {
    let penalty = 0;

    // ATR-based volatility penalty
    const atrClassification = report.indicators?.atr?.classification;
    if (atrClassification === 'high') penalty += 8;
    else if (atrClassification === 'medium') penalty += 4;

    // Volume-volatility mismatch
    const volumeStrength = report.indicators?.volume?.score || 0.5;
    if (atrClassification === 'high' && volumeStrength < 0.4) penalty += 4;

    // News shock detection
    const newsScore = this.calculateNewsScore(report);
    if (newsScore < 30) penalty += 3; // High negative news impact

    return Math.min(15, penalty);
  }

  /**
   * Apply special rules and final adjustments
   */
  private applySpecialRules(baseAccuracy: number, report: DeepResearchReport): number {
    let accuracy = baseAccuracy;

    // Metadata provider failure penalty
    if (!report.providers?.metadata?.success) {
      accuracy *= 0.7;
    }

    // Indicator conflicts penalty
    const macdSignal = report.indicators?.macd?.signal;
    const emaTrend = report.indicators?.ema20?.emaTrend;
    if ((macdSignal === 'bullish' && emaTrend === 'bearish') ||
        (macdSignal === 'bearish' && emaTrend === 'bullish')) {
      accuracy -= 15;
    }

    // Immediate resistance/support penalty
    const vwapDeviation = report.indicators?.vwap?.deviation || 0;
    const signal = report.signal;
    if ((signal === 'BUY' && vwapDeviation > 2) ||
        (signal === 'SELL' && vwapDeviation < -2)) {
      accuracy -= 10;
    }

    // Low volume + neutral momentum cap
    const momentumScore = this.calculateMomentumScore(report);
    const volumeScore = this.calculateVolumeScore(report);
    if (volumeScore < 40 && momentumScore < 60) {
      accuracy = Math.min(accuracy, 60);
    }

    // Note: AI confidence logic has been merged into the unified accuracy calculation
    // All confidence factors are now integrated into the multi-factor scoring above

    return Math.max(0, Math.min(100, accuracy));
  }

  /**
   * Save prediction snapshot to Firestore
   */
  async savePredictionSnapshot(userId: string, snapshotPayload: any): Promise<void> {
    try {
      await firestoreAdapter.savePredictionMetrics(userId, {
        ...snapshotPayload,
        timestamp: new Date(),
        version: 'v1.0'
      });
      logger.debug({ userId, requestId: snapshotPayload.requestId }, 'Prediction snapshot saved');
    } catch (error: any) {
      logger.error({ error: error.message, userId }, 'Failed to save prediction snapshot');
      throw error;
    }
  }

  /**
   * Record prediction outcome and update historical metrics
   */
  async recordPredictionOutcome(requestId: string, outcome: { win: boolean; pnl: number; durationSeconds?: number }): Promise<void> {
    try {
      // First, find the original snapshot
      const snapshot = await firestoreAdapter.getPredictionSnapshot(requestId);
      if (!snapshot) {
        logger.warn({ requestId }, 'No snapshot found for outcome recording');
        return;
      }

      // Record the outcome
      await firestoreAdapter.updatePredictionOutcome(requestId, {
        ...outcome,
        recordedAt: new Date(),
        finalPnl: outcome.pnl
      });

      // Update rolling statistics
      const bucketKey = Math.floor(snapshot.snapshotAccuracy / 10) * 10; // 0-10, 10-20, etc.
      await firestoreAdapter.updateAccuracyCalibration(snapshot.userId, bucketKey, outcome.win);

      logger.debug({ requestId, outcome: outcome.win }, 'Prediction outcome recorded');
    } catch (error: any) {
      logger.error({ error: error.message, requestId }, 'Failed to record prediction outcome');
      throw error;
    }
  }
}

export const accuracyEngine = new AccuracyEngine();