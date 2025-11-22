import type { LiquidityResult } from './strategies/liquidityStrategy';
import type { VolumeResult } from './strategies/volumeStrategy';
import type { SentimentResult } from './strategies/sentimentStrategy';
import type { DerivativesResult } from './strategies/derivativesStrategy';

const FEATURE_WEIGHTS = {
  rsi: 1.0,
  macdHistogram: 1.2,
  trendStrength: 1.0,
  orderbookImbalance: 1.3,
  volumeDepth: 0.8,
  liquiditySpread: 0.7,
  volatility: 0.6,
  sentiment: 1.1,
  derivatives: 1.2,
  priceMomentum: 0.8,
} as const;

type WeightedFeatureKey = keyof typeof FEATURE_WEIGHTS;
type FeatureScoreKey = WeightedFeatureKey | 'microStructure';

const FEATURE_KEYS: FeatureScoreKey[] = [
  'rsi',
  'macdHistogram',
  'trendStrength',
  'orderbookImbalance',
  'volumeDepth',
  'liquiditySpread',
  'volatility',
  'sentiment',
  'derivatives',
  'priceMomentum',
  'microStructure',
];

const MIN_CONFIDENCE = 35;
const MAX_CONFIDENCE = 95;
const SIGMOID_SHAPING = 1.35;

const confidenceMemory = new Map<string, number>();

export interface ConfidenceFeatureInputs {
  symbol: string;
  timeframe: string;
  price: number;
  rsi?: { value?: number | null } | null;
  macd?: { histogram?: number | null; trend?: string | null } | null;
  trendStrength?:
    | {
        ema12?: number | null;
        ema26?: number | null;
        ema20?: number | null;
        ema50?: number | null;
        trend?: string | null;
      }
    | null;
  orderbookImbalance?: number | null;
  volume?: VolumeResult | null;
  liquidity?: LiquidityResult | null;
  volatility?: { atr?: number | null; price?: number | null } | null;
  sentiment?: SentimentResult | null;
  derivatives?: DerivativesResult | null;
  priceMomentum?: number | null;
  microSignals?:
    | {
        spread?: number | null;
        volume?: number | null;
        priceMomentum?: number | null;
        orderbookDepth?: number | null;
      }
    | null;
}

export interface FeatureScoreState {
  perFeatureScore: Record<FeatureScoreKey, number>;
  availability: Record<FeatureScoreKey, boolean>;
  metadata: {
    symbol?: string;
    timeframe?: string;
    cacheKey: string;
  };
}

export interface ConfidenceBreakdown {
  technicals: number;
  orderFlow: number;
  sentiment: number;
  derivatives: number;
  volatility: number;
  momentum: number;
  liquidity: number;
  microStructure: number;
}

export interface ConfidenceComputationResult {
  confidence: number;
  smoothedConfidence: number;
  rawConfidence: number;
  accuracyRange: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  perFeatureScore: Record<FeatureScoreKey, number>;
  confidenceBreakdown: ConfidenceBreakdown;
  confluenceFlags: Record<string, boolean>;
  fusedScore: number;
}

interface FuseResult {
  weightedScore: number;
  totalWeight: number;
}

export function normalizeScore(
  value: number | null | undefined,
  options: {
    center?: number;
    scale?: number;
    min?: number;
    max?: number;
    clamp?: number;
  } = {}
): number {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 0;
  }
  const { center = 0, scale, min, max, clamp = 2 } = options;
  let normalized: number;
  if (typeof scale === 'number' && scale !== 0) {
    normalized = (value - center) / scale;
  } else if (typeof min === 'number' && typeof max === 'number' && max !== min) {
    const clipped = Math.min(max, Math.max(min, value));
    normalized = ((clipped - min) / (max - min)) * 2 - 1;
  } else {
    normalized = value - center;
  }
  if (typeof clamp === 'number' && clamp > 0) {
    normalized = Math.max(-clamp, Math.min(clamp, normalized));
  }
  return normalized;
}

export function computeFeatureScores(features: ConfidenceFeatureInputs): FeatureScoreState {
  const perFeatureScore: Record<FeatureScoreKey, number> = {} as Record<FeatureScoreKey, number>;
  const availability: Record<FeatureScoreKey, boolean> = {} as Record<FeatureScoreKey, boolean>;

  FEATURE_KEYS.forEach((key) => {
    perFeatureScore[key] = 0;
    availability[key] = false;
  });

  const metadata = {
    symbol: features.symbol,
    timeframe: features.timeframe,
    cacheKey: `${features.symbol || 'UNKNOWN'}:${features.timeframe || 'NA'}`,
  };

  const rsiValue = features.rsi?.value;
  if (isFiniteNumber(rsiValue)) {
    const deviation = 50 - (rsiValue as number);
    perFeatureScore.rsi = normalizeScore(deviation, { center: 0, scale: 12, clamp: 2.5 });
    availability.rsi = true;
  }

  const macdHistogram = features.macd?.histogram;
  if (isFiniteNumber(macdHistogram)) {
    const scale = Math.max(0.0015, Math.abs(macdHistogram as number) * 3 || 0.004);
    perFeatureScore.macdHistogram = normalizeScore(macdHistogram as number, { scale, clamp: 2.5 });
    availability.macdHistogram = true;
  } else if (features.macd?.trend) {
    perFeatureScore.macdHistogram = trendStringToScore(features.macd.trend);
    availability.macdHistogram = true;
  }

  const trendSignals: Array<number | null> = [];
  const ema12 = features.trendStrength?.ema12;
  const ema26 = features.trendStrength?.ema26;
  const ema20 = features.trendStrength?.ema20;
  const ema50 = features.trendStrength?.ema50;

  if (isFiniteNumber(ema12) && isFiniteNumber(ema26) && Math.abs(ema26 as number) > 1e-8) {
    const ratio = ((ema12 as number) - (ema26 as number)) / Math.max(Math.abs(ema26 as number), 1e-8);
    trendSignals.push(normalizeScore(ratio, { center: 0, scale: 0.05, clamp: 2 }));
  }
  if (isFiniteNumber(ema20) && isFiniteNumber(ema50) && Math.abs(ema50 as number) > 1e-8) {
    const ratio = ((ema20 as number) - (ema50 as number)) / Math.max(Math.abs(ema50 as number), 1e-8);
    trendSignals.push(normalizeScore(ratio, { center: 0, scale: 0.05, clamp: 2 }));
  }
  if (features.trendStrength?.trend) {
    trendSignals.push(trendStringToScore(features.trendStrength.trend));
  }
  const trendScore = safeAverage(trendSignals);
  if (trendScore !== null) {
    perFeatureScore.trendStrength = trendScore;
    availability.trendStrength = true;
  }

  if (isFiniteNumber(features.orderbookImbalance)) {
    perFeatureScore.orderbookImbalance = normalizeScore(features.orderbookImbalance as number, {
      center: 0,
      scale: 0.4,
      clamp: 2,
    });
    availability.orderbookImbalance = true;
  }

  const volumeScores: Array<number | null> = [];
  if (isFiniteNumber(features.volume?.relativeVolume)) {
    const delta = (features.volume!.relativeVolume as number) - 1;
    volumeScores.push(normalizeScore(delta, { center: 0, scale: 0.8, clamp: 2 }));
  }
  const depth = (features.liquidity?.bidDepth ?? 0) + (features.liquidity?.askDepth ?? 0);
  if (depth > 0) {
    volumeScores.push(normalizeScore(Math.log10(depth + 1), { center: 5, scale: 1.2, clamp: 2 }));
  }
  const volumeScore = safeAverage(volumeScores);
  if (volumeScore !== null) {
    perFeatureScore.volumeDepth = volumeScore;
    availability.volumeDepth = true;
  }

  const spreadPercent = features.liquidity?.spreadPercent;
  if (isFiniteNumber(spreadPercent)) {
    const optimalSpread = 0.2;
    const spreadDeviation = optimalSpread - (spreadPercent as number);
    perFeatureScore.liquiditySpread = normalizeScore(spreadDeviation, { center: 0, scale: 0.2, clamp: 2 });
    availability.liquiditySpread = true;
  }

  const atr = features.volatility?.atr;
  const price = features.volatility?.price ?? features.price;
  if (isFiniteNumber(atr) && isFiniteNumber(price) && (price as number) > 0) {
    const relAtr = (atr as number) / (price as number);
    const targetVol = 0.02;
    const deviation = targetVol - relAtr;
    perFeatureScore.volatility = normalizeScore(deviation, { center: 0, scale: 0.015, clamp: 1.5 });
    availability.volatility = true;
  }

  const sentimentValue = resolveSentiment(features.sentiment);
  if (sentimentValue !== null) {
    perFeatureScore.sentiment = normalizeScore(sentimentValue, { center: 0, scale: 0.35, clamp: 2 });
    availability.sentiment = true;
  }

  const overallScore = features.derivatives?.overallScore;
  if (isFiniteNumber(overallScore)) {
    const bias = (overallScore as number) - 0.5;
    let derivativeScore = normalizeScore(bias, { center: 0, scale: 0.18, clamp: 2 });
    const direction = features.derivatives?.overallSignal;
    if (direction === 'Bearish') {
      derivativeScore = -Math.abs(derivativeScore);
    } else if (direction === 'Bullish') {
      derivativeScore = Math.abs(derivativeScore);
    }
    perFeatureScore.derivatives = derivativeScore;
    availability.derivatives = true;
  }

  if (isFiniteNumber(features.priceMomentum)) {
    perFeatureScore.priceMomentum = normalizeScore(features.priceMomentum as number, {
      center: 0,
      scale: 3,
      clamp: 2,
    });
    availability.priceMomentum = true;
  }

  const microScores: Array<number | null> = [];
  if (isFiniteNumber(features.microSignals?.spread)) {
    const spreadBias = 0.25 - (features.microSignals!.spread as number);
    microScores.push(normalizeScore(spreadBias, { center: 0, scale: 0.2, clamp: 1.5 }));
  }
  if (isFiniteNumber(features.microSignals?.volume)) {
    microScores.push(
      normalizeScore(Math.log10((features.microSignals!.volume as number) + 1), { center: 4, scale: 1.5, clamp: 1.5 })
    );
  }
  if (isFiniteNumber(features.microSignals?.orderbookDepth)) {
    microScores.push(
      normalizeScore(Math.log10((features.microSignals!.orderbookDepth as number) + 1), {
        center: 5,
        scale: 1.5,
        clamp: 1.5,
      })
    );
  }
  if (isFiniteNumber(features.microSignals?.priceMomentum)) {
    microScores.push(
      normalizeScore(features.microSignals!.priceMomentum as number, { center: 0, scale: 3, clamp: 1.5 })
    );
  }
  const microScore = safeAverage(microScores);
  if (microScore !== null) {
    perFeatureScore.microStructure = microScore;
    availability.microStructure = true;
  }

  return { perFeatureScore, availability, metadata };
}

export function fuseSignals(scoreState: FeatureScoreState): FuseResult {
  let weightedSum = 0;
  let totalWeight = 0;

  (Object.keys(FEATURE_WEIGHTS) as WeightedFeatureKey[]).forEach((key) => {
    if (!scoreState.availability[key]) {
      return;
    }
    const weight = FEATURE_WEIGHTS[key];
    weightedSum += scoreState.perFeatureScore[key] * weight;
    totalWeight += weight;
  });

  return {
    weightedScore: totalWeight > 0 ? weightedSum / totalWeight : 0,
    totalWeight,
  };
}

export function computeConfidence(scoreState: FeatureScoreState): ConfidenceComputationResult {
  const fused = fuseSignals(scoreState);
  const logisticInput = fused.weightedScore * SIGMOID_SHAPING;
  const probability = sigmoid(logisticInput);
  const boundedProbability = clamp(probability, MIN_CONFIDENCE / 100, MAX_CONFIDENCE / 100);
  const rawConfidence = Math.round(boundedProbability * 100);

  const cacheKey = scoreState.metadata.cacheKey;
  const previous = confidenceMemory.get(cacheKey) ?? rawConfidence;
  const smoothedValue = rawConfidence * 0.7 + previous * 0.3;
  const smoothedConfidence = Math.round(clamp(smoothedValue, MIN_CONFIDENCE, MAX_CONFIDENCE));

  confidenceMemory.set(cacheKey, smoothedConfidence);

  const confidenceBreakdown = buildConfidenceBreakdown(scoreState);
  const confluenceFlags = buildConfluenceFlags(scoreState);
  const accuracyRange = buildAccuracyRange(smoothedConfidence);
  const signal = deriveSignal(fused.weightedScore);

  return {
    confidence: smoothedConfidence,
    smoothedConfidence,
    rawConfidence,
    accuracyRange,
    signal,
    perFeatureScore: scoreState.perFeatureScore,
    confidenceBreakdown,
    confluenceFlags,
    fusedScore: fused.weightedScore,
  };
}

function resolveSentiment(sentiment?: SentimentResult | null): number | null {
  if (!sentiment) {
    return null;
  }
  if (isFiniteNumber(sentiment.sentiment)) {
    return sentiment.sentiment as number;
  }
  if (isFiniteNumber(sentiment.score)) {
    return (sentiment.score - 0.5) * 2;
  }
  return null;
}

function trendStringToScore(trend?: string | null): number {
  if (!trend) {
    return 0;
  }
  const normalized = trend.toUpperCase();
  if (normalized.includes('BULL')) {
    return 1;
  }
  if (normalized.includes('BEAR')) {
    return -1;
  }
  return 0;
}

function safeAverage(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => typeof value === 'number' && !Number.isNaN(value));
  if (!valid.length) {
    return null;
  }
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function buildAccuracyRange(confidence: number): string {
  const lower = Math.max(MIN_CONFIDENCE, confidence - 5);
  const upper = Math.min(MAX_CONFIDENCE, confidence + 5);
  return `${lower}-${upper}%`;
}

function deriveSignal(weightedScore: number): 'BUY' | 'SELL' | 'HOLD' {
  if (weightedScore >= 0.25) {
    return 'BUY';
  }
  if (weightedScore <= -0.25) {
    return 'SELL';
  }
  return 'HOLD';
}

function buildConfidenceBreakdown(scoreState: FeatureScoreState): ConfidenceBreakdown {
  const { perFeatureScore } = scoreState;
  const average = (keys: FeatureScoreKey[]): number => {
    const values = keys
      .map((key) => perFeatureScore[key])
      .filter((value) => typeof value === 'number' && !Number.isNaN(value));
    if (!values.length) {
      return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };

  return {
    technicals: average(['rsi', 'macdHistogram', 'trendStrength']),
    orderFlow: average(['orderbookImbalance', 'volumeDepth']),
    sentiment: perFeatureScore.sentiment ?? 0,
    derivatives: perFeatureScore.derivatives ?? 0,
    volatility: perFeatureScore.volatility ?? 0,
    momentum: perFeatureScore.priceMomentum ?? 0,
    liquidity: perFeatureScore.liquiditySpread ?? 0,
    microStructure: perFeatureScore.microStructure ?? 0,
  };
}

function buildConfluenceFlags(scoreState: FeatureScoreState): Record<string, boolean> {
  const { perFeatureScore } = scoreState;
  const direction = (value: number): number => {
    if (value > 0.15) return 1;
    if (value < -0.15) return -1;
    return 0;
  };

  return {
    rsiMacdAligned:
      direction(perFeatureScore.rsi) !== 0 &&
      direction(perFeatureScore.rsi) === direction(perFeatureScore.macdHistogram),
    trendMomentumAligned:
      direction(perFeatureScore.trendStrength) !== 0 &&
      direction(perFeatureScore.trendStrength) === direction(perFeatureScore.priceMomentum),
    derivativesConfirmSentiment:
      direction(perFeatureScore.derivatives) !== 0 &&
      direction(perFeatureScore.derivatives) === direction(perFeatureScore.sentiment),
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

