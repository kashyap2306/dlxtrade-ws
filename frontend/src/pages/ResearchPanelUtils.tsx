// Utility functions for ResearchPanel component

export const canExecute = (accuracy: number, settings?: any): boolean => {
  if (!settings) return false;
  return settings.autoTradeEnabled && accuracy >= (settings.minAccuracyThreshold || 0.85);
};

/**
 * Calculates a multi-strategy accuracy score based on defined weights and buckets.
 * Formula: accuracy = (0.40 * tech + 0.30 * price + 0.15 * vol + 0.15 * sentiment) * agreementFactor
 */
/**
 * Calculates a multi-strategy accuracy score based on defined weights and buckets.
 * Hardened v2.0: Includes confidence dampening, sentiment penalties, and multi-type agreement safety.
 */
export const calculateMultiStrategyAccuracy = (analysis: any, newsData: any) => {
  if (!analysis) {
    return {
      accuracy: 0.5,
      accuracyBreakdown: { technical: 0, priceAction: 0, volatility: 0, sentiment: 0 },
      strategies: {}
    };
  }

  const strategies: Record<string, { signal: number; confidence: number; type: string; meta: Record<string, number> }> = {};

  // Storage for bucket averages
  const buckets: Record<string, { totalConf: number; count: number; types: Set<string> }> = {
    technical: { totalConf: 0, count: 0, types: new Set() },
    priceAction: { totalConf: 0, count: 0, types: new Set() },
    volatility: { totalConf: 0, count: 0, types: new Set() },
    sentiment: { totalConf: 0, count: 0, types: new Set() }
  };

  let bullishCount = 0;
  let bearishCount = 0;

  const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(max, val));

  const registerStrategy = (name: string, bucket: string, type: string, signal: number, rawConfidence: number, signalStrength: number, meta: any = {}) => {
    // 1) CONFIDENCE DAMPENING: rawConfidence * clamp(signalStrength, 0.2, 1)
    const dampedConfidence = rawConfidence * clamp(signalStrength || 0.5, 0.2, 1.0);
    const roundedSignal = signal >= 1 ? 1 : (signal <= -1 ? -1 : 0);

    strategies[name] = {
      signal: roundedSignal,
      confidence: Number.isFinite(dampedConfidence) ? dampedConfidence : 0,
      type,
      meta
    };

    if (roundedSignal !== 0) {
      if (roundedSignal === 1) bullishCount++;
      if (roundedSignal === -1) bearishCount++;

      buckets[bucket].totalConf += dampedConfidence;
      buckets[bucket].count++;
      buckets[bucket].types.add(type);
    }
  };

  const indicators = analysis.technicalIndicators || {};
  const pa = analysis.priceAction || {};
  const vol = analysis.volatility || {};
  const sr = analysis.supportResistance || {};
  const pat = analysis.patterns || {};
  const mom = analysis.momentum || {};

  // --- DATA SOURCES ---
  const currentPrice = pa.currentPrice || 0;
  const atrVal = vol.atr?.value || (currentPrice * 0.02);

  // 1. TECHNICAL
  // RSI (Type: Momentum)
  if (indicators.rsi?.value !== undefined) {
    const val = indicators.rsi.value;
    const sig = val < 30 ? 1 : (val > 70 ? -1 : 0);
    const strength = Math.abs(val - 50) / 50;
    registerStrategy('RSI', 'technical', 'momentum', sig, 0.9, strength, { rsi: val });
  }

  // MACD (Type: Momentum)
  if (indicators.macd?.value !== undefined) {
    const val = indicators.macd.value;
    const sig = val > 0 ? 1 : (val < 0 ? -1 : 0);
    registerStrategy('MACD', 'technical', 'momentum', sig, 0.7, 0.6);
  }

  // EMA Cross (20/50) (Type: Trend)
  if (indicators.ema20?.value && indicators.ema50?.value) {
    const dist = Math.abs(indicators.ema20.value - indicators.ema50.value);
    const strength = (dist / currentPrice) * 50;
    const sig = indicators.ema20.value > indicators.ema50.value ? 1 : -1;
    registerStrategy('EMA_Trend', 'technical', 'trend', sig, 0.8, strength);
  }

  // SMA Alignment (50/200) (Type: Trend) - NEW
  if (indicators.ma50?.value && indicators.ma200?.value) {
    const sig = indicators.ma50.value > indicators.ma200.value ? 1 : -1;
    registerStrategy('SMA_Alignment', 'technical', 'trend', sig, 0.85, 0.7);
  }

  // Momentum (Type: Momentum)
  if (mom.momentumScore !== undefined) {
    const strength = Math.abs(mom.momentumScore - 0.5) * 2;
    const sig = mom.momentumScore > 0.6 ? 1 : (mom.momentumScore < 0.4 ? -1 : 0);
    registerStrategy('Momentum', 'technical', 'momentum', sig, 0.75, strength);
  }

  // Volume Flow (Type: Volume) - NEW
  const volData = analysis.volume || {};
  if (volData.score !== undefined) {
    const sig = volData.score > 60 ? 1 : (volData.score < 40 ? -1 : 0);
    registerStrategy('Volume_Flow', 'technical', 'volume', sig, 0.7, (volData.score / 100));
  }

  // Mean Reversion (Z-Score approximation) - NEW
  if (indicators.ema20?.value && currentPrice > 0) {
    const deviation = (currentPrice - indicators.ema20.value) / indicators.ema20.value;
    const sig = deviation > 0.05 ? -1 : (deviation < -0.05 ? 1 : 0); // Revert back to mean
    registerStrategy('Mean_Reversion', 'technical', 'reversion', sig, 0.6, Math.abs(deviation) * 10);
  }

  // 2. PRICE ACTION
  // S/R Alignment (Type: S/R)
  if (currentPrice && sr) {
    if (sr.minorSupport && currentPrice > sr.minorSupport) {
      const dist = currentPrice - sr.minorSupport;
      const strength = clamp(1 - (dist / (currentPrice * 0.05)), 0, 1);
      if (dist < currentPrice * 0.03) registerStrategy('Support_Alignment', 'priceAction', 'sr', 1, 0.9, strength);
    }
    if (sr.minorResistance && currentPrice < sr.minorResistance) {
      const dist = sr.minorResistance - currentPrice;
      const strength = clamp(1 - (dist / (currentPrice * 0.05)), 0, 1);
      if (dist < currentPrice * 0.03) registerStrategy('Resistance_Alignment', 'priceAction', 'sr', -1, 0.9, strength);
    }
  }

  // VWAP (Type: Levels)
  if (pa.vwap?.value) {
    const dist = Math.abs(currentPrice - pa.vwap.value);
    const strength = dist / (atrVal || 1);
    registerStrategy('VWAP', 'priceAction', 'levels', pa.vwapSignal === 'bullish' ? 1 : -1, 0.8, strength);
  }

  // Patterns (Type: Pattern)
  if (pat.activePattern) {
    const bullishPatterns = ['double_bottom', 'inverse_head_shoulders', 'bull_flag'];
    const sig = bullishPatterns.includes(pat.activePattern) ? 1 : -1;
    registerStrategy('Patterns', 'priceAction', 'pattern', sig, 0.85, 0.7);
  }

  // Strategy-safe logic for Bollinger dummy (Type: Volatility)
  // Logic: Narrow ATR vs recent suggests Bollinger Squeeze
  if (atrVal > 0) {
    const squeezeSignal = atrVal < (currentPrice * 0.01) ? 1 : 0;
    if (squeezeSignal) registerStrategy('Bollinger_Squeeze', 'priceAction', 'volatility', 1, 0.5, 0.5);
  }

  // 3. VOLATILITY
  if (vol.atr?.value !== undefined) {
    const sig = vol.atr.value < 2 ? 1 : (vol.atr.value > 5 ? -1 : 0);
    registerStrategy('ATR_Vol', 'volatility', 'vol', sig, 0.6, 0.5);
  }

  // 4. SENTIMENT
  const articles = newsData?.articles || [];
  let rawSentimentScore = 0;
  if (articles.length > 0) {
    let sentSum = 0;
    articles.forEach((a: any) => {
      if (a.sentiment === 'positive') sentSum += 1;
      else if (a.sentiment === 'negative') sentSum -= 1;
    });
    rawSentimentScore = sentSum / articles.length;
    registerStrategy('Sentiment', 'sentiment', 'sentiment', rawSentimentScore > 0 ? 1 : -1, Math.abs(rawSentimentScore), Math.abs(rawSentimentScore));
  }

  // Bucket Scorers (INTRA-BUCKET NORMALIZATION)
  const getBucketScore = (key: string) => {
    const b = buckets[key];
    if (b.count === 0) return 0.5;

    // Average confidences
    let avgConf = b.totalConf / b.count;

    // Cap bucket score at 0.85 unless at least 2 different strategy TYPES agree
    if (b.types.size < 2 && avgConf > 0.85) {
      avgConf = 0.85;
    }

    return clamp(avgConf, 0, 1);
  };

  // 2) SENTIMENT PENALTY FIX
  const sentimentAdjusted = (rawSentimentScore + 1) / 2; // maps -1..1 → 0..1

  const accuracyBreakdown = {
    technical: getBucketScore('technical'),
    priceAction: getBucketScore('priceAction'),
    volatility: getBucketScore('volatility'),
    sentiment: sentimentAdjusted
  };

  // Composite Calculation
  const compositeAcc = (
    0.40 * accuracyBreakdown.technical +
    0.30 * accuracyBreakdown.priceAction +
    0.15 * accuracyBreakdown.volatility +
    0.15 * accuracyBreakdown.sentiment
  );

  // 3) AGREEMENT FACTOR SAFETY (Direction-Neutral & Granular)
  const totalDirectionalSignals = bullishCount + bearishCount;
  const majorityCount = Math.max(bullishCount, bearishCount);
  const internalAgreement = totalDirectionalSignals > 0 ? (majorityCount / totalDirectionalSignals) : 1.0;

  // Adaptive count penalty: more signals = higher possible confidence
  const countPenalty = totalDirectionalSignals === 0 ? 0.5 :
    totalDirectionalSignals === 1 ? 0.75 :
      totalDirectionalSignals === 2 ? 0.9 : 1.0;

  let agreementFactor = internalAgreement * countPenalty;

  // Confluence Boost: If we have high agreement across many signals
  if (totalDirectionalSignals >= 5 && internalAgreement >= 0.8) {
    agreementFactor = Math.min(1.1, agreementFactor * 1.1);
  }

  let finalAccuracy = compositeAcc * agreementFactor;

  // Sentiment Penalty Condition
  if (rawSentimentScore < -0.5) {
    finalAccuracy *= 0.7;
  }

  // ATR Percentile Penalty (Adaptive & Explainable)
  let volatilityPenaltyApplied = false;
  let volatilityPenaltyReason = "";
  const atrPercentileVal = vol.atr?.percentile ?? indicators.atr?.percentile;

  if (typeof atrPercentileVal === 'number' && isFinite(atrPercentileVal)) {
    let multiplier = 1.0;

    if (atrPercentileVal >= 0.95) {
      multiplier = 0.75;
      volatilityPenaltyApplied = true;
    } else if (atrPercentileVal >= 0.9) {
      multiplier = 0.85;
      volatilityPenaltyApplied = true;
    } else if (atrPercentileVal >= 0.85) {
      multiplier = 0.93;
      volatilityPenaltyApplied = true;
    }

    if (volatilityPenaltyApplied) {
      finalAccuracy *= multiplier;
      volatilityPenaltyReason = `Extreme volatility (ATR percentile: ${(atrPercentileVal * 100).toFixed(1)}%)`;
    }
  }

  // 5) FINAL ACCURACY CLAMP: strictly 0.05 .. 0.95
  return {
    accuracy: clamp(finalAccuracy, 0.05, 0.95),
    accuracyBreakdown,
    strategies,
    volatilityPenaltyApplied,
    volatilityPenaltyReason,
    atrPercentile: typeof atrPercentileVal === 'number' ? atrPercentileVal : 0
  };
};
