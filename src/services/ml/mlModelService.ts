/**
 * ML Model Service
 * Wrapper for ML model inference (connects to Python service or uses ONNX)
 * 
 * This service provides a TypeScript interface to ML models.
 * Actual model training/inference happens in a Python service.
 */

import { logger } from '../../utils/logger';
import type { FeatureVector } from '../featureEngine';

export interface ModelPrediction {
  signal: 'BUY' | 'SELL' | 'HOLD';
  probability: number; // Calibrated probability 0-1
  confidence: number; // 0-100
  explanations: string[]; // Top 6 positive + top 3 negative SHAP explanations
  shapValues?: Record<string, number>; // Feature contributions
  accuracyRange?: string;
  shap?: {
    featureNames: string[];
    values: number[];
    baseValue?: number;
  };
  probabilities?: {
    BUY?: number | null;
    SELL?: number | null;
    HOLD?: number | null;
  };
}

export interface ModelMetrics {
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
  confusionMatrix: {
    trueBuy: number;
    trueSell: number;
    trueHold: number;
    predictedBuy: number;
    predictedSell: number;
    predictedHold: number;
  };
  profitFactor: number;
  maxDrawdown: number;
  lastUpdated: string;
}

export class MLModelService {
  private modelEndpoint: string;
  private usePythonService: boolean;
  private cachedPredictions: Map<string, { prediction: ModelPrediction; timestamp: number }> = new Map();
  private readonly cacheTTL = 1000; // 1 second

  constructor(modelEndpoint?: string) {
    // If Python service endpoint provided, use it; otherwise use local inference
    this.modelEndpoint = modelEndpoint || process.env.ML_SERVICE_URL || 'http://localhost:5001';
    this.usePythonService = true;
  }

  /**
   * Predict signal from feature vector
   * This calls the Python ML service or uses ONNX runtime
   */
  async predict(featureVector: FeatureVector, symbol: string): Promise<ModelPrediction> {
    try {
      // Check cache
      const cacheKey = `${symbol}_${featureVector.timestamp}`;
      const cached = this.cachedPredictions.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
        return cached.prediction;
      }

      if (this.usePythonService) {
        // Call Python ML service
        const prediction = await this.predictViaPythonService(featureVector, symbol);
        this.cachedPredictions.set(cacheKey, { prediction, timestamp: Date.now() });
        return prediction;
      } else {
        // Use local inference (would require ONNX runtime or similar)
        // For now, return a placeholder that uses rule-based logic
        const prediction = await this.predictLocal(featureVector);
        this.cachedPredictions.set(cacheKey, { prediction, timestamp: Date.now() });
        return prediction;
      }
    } catch (error: any) {
      logger.error({ error: error.message, symbol }, 'ML model prediction failed');
      // Fallback to rule-based prediction
      return this.predictLocal(featureVector);
    }
  }

  /**
   * Predict via Python ML service (HTTP API)
   */
  private async predictViaPythonService(featureVector: FeatureVector, symbol: string): Promise<ModelPrediction> {
    const axios = await import('axios');
    const { vector, names } = this.flattenFeatureVector(featureVector);

    const response = await axios.default.post(
      `${this.modelEndpoint}/predict`,
      {
        symbol,
        timeframe: '5m',
        features: vector,
        featureNames: names,
        timestamp: featureVector.timestamp,
      },
      { timeout: Number(process.env.ML_SERVICE_TIMEOUT || 4000) }
    );

    const shapValues: Record<string, number> = {};
    if (Array.isArray(response.data?.shap?.featureNames) && Array.isArray(response.data?.shap?.values)) {
      response.data.shap.featureNames.forEach((name: string, idx: number) => {
        shapValues[name] = response.data.shap.values[idx] ?? 0;
      });
    }

    return {
      signal: response.data.signal,
      probability: response.data.probability,
      confidence: Math.round((response.data.confidence ?? response.data.probability) * 100),
      explanations: response.data.explanations || [],
      shapValues: Object.keys(shapValues).length ? shapValues : undefined,
      shap: response.data.shap,
      accuracyRange: response.data.accuracyRange || this.deriveAccuracyRange(response.data.probability),
      probabilities: response.data.probabilities,
    };
  }

  /**
   * Local prediction (rule-based fallback until ML model is trained)
   */
  private async predictLocal(featureVector: FeatureVector): Promise<ModelPrediction> {
    const { technical, orderbook, trades, volume, flags } = featureVector;

    // Rule-based signal generation (temporary until ML model is ready)
    let buyScore = 0;
    let sellScore = 0;
    const explanations: string[] = [];

    // RSI signals
    if (flags.rsi5_oversold || flags.rsi14_oversold) {
      buyScore += 2;
      explanations.push(`RSI(${technical.rsi5 < 30 ? '5' : '14'}) < 30 (oversold) — supports LONG`);
    }
    if (flags.rsi5_overbought || flags.rsi14_overbought) {
      sellScore += 2;
      explanations.push(`RSI(${technical.rsi5 > 70 ? '5' : '14'}) > 70 (overbought) — supports SHORT`);
    }

    // MACD signals
    if (flags.macd_bullish) {
      buyScore += 1.5;
      explanations.push('MACD bullish crossover — supports LONG');
    }
    if (flags.macd_bearish) {
      sellScore += 1.5;
      explanations.push('MACD bearish crossover — supports SHORT');
    }

    // Orderbook imbalance
    if (flags.buy_imbalance) {
      buyScore += 1;
      explanations.push(`Orderbook buy imbalance ${(orderbook.imbalance * 100).toFixed(1)}% — supports LONG`);
    }
    if (flags.sell_imbalance) {
      sellScore += 1;
      explanations.push(`Orderbook sell imbalance ${(Math.abs(orderbook.imbalance) * 100).toFixed(1)}% — supports SHORT`);
    }

    // Volume spike
    if (flags.volume_spike) {
      buyScore += 0.5;
      explanations.push(`Volume spike ${volume.volumeSpikePercent.toFixed(1)}% — increased activity`);
    }

    // Determine signal
    const totalScore = buyScore + sellScore;
    let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let probability = 0.5;

    if (buyScore > sellScore && buyScore >= 2) {
      signal = 'BUY';
      probability = Math.min(0.95, 0.5 + (buyScore / 10));
    } else if (sellScore > buyScore && sellScore >= 2) {
      signal = 'SELL';
      probability = Math.min(0.95, 0.5 + (sellScore / 10));
    }

    // Limit explanations to top 6
    const topExplanations = explanations.slice(0, 6);

    return {
      signal,
      probability,
      confidence: Math.round(probability * 100),
      accuracyRange: this.deriveAccuracyRange(probability),
      explanations: topExplanations,
    };
  }

  /**
   * Convert feature vector to array format for ML model
   */
  private flattenFeatureVector(featureVector: FeatureVector): { vector: number[]; names: string[] } {
    const vector: number[] = [];
    const names: string[] = [];
    const push = (name: string, value: number | boolean | null | undefined) => {
      let numericValue = 0;
      if (typeof value === 'boolean') {
        numericValue = value ? 1 : 0;
      } else if (value !== null && value !== undefined && !Number.isNaN(Number(value))) {
        numericValue = Number(value);
      }
      vector.push(numericValue);
      names.push(name);
    };

    const { technical, orderbook, trades, volume, normalized, percentiles, flags, multiTimeframe, deltas } =
      featureVector;

    // Technical indicators
    push('technical_rsi5', technical.rsi5);
    push('technical_rsi14', technical.rsi14);
    push('technical_macd', technical.macd);
    push('technical_macdSignal', technical.macdSignal);
    push('technical_macdHistogram', technical.macdHistogram);
    push('technical_ema12', technical.ema12);
    push('technical_ema26', technical.ema26);
    push('technical_ema50', technical.ema50);
    push('technical_adx', technical.adx);
    push('technical_adxPlus', technical.adxPlus);
    push('technical_adxMinus', technical.adxMinus);

    // Orderbook
    push('orderbook_bidVolumeTop10', orderbook.bidVolumeTop10);
    push('orderbook_askVolumeTop10', orderbook.askVolumeTop10);
    push('orderbook_imbalance', orderbook.imbalance);
    push('orderbook_spread', orderbook.spread);
    push('orderbook_depth', orderbook.depth);
    push('orderbook_midPrice', orderbook.midPrice);

    // Trades
    push('trades_takerBuyVolume', trades.takerBuyVolume);
    push('trades_takerSellVolume', trades.takerSellVolume);
    push('trades_takerBuySellRatio', trades.takerBuySellRatio);
    push('trades_aggressiveBuyRatio', trades.aggressiveBuyRatio);
    push('trades_tradeCount', trades.tradeCount);

    // Volume
    push('volume_24h', volume.volume24h);
    push('volume_spikePercent', volume.volumeSpikePercent);
    push('volume_vwap', volume.vwap);
    push('volume_vwapDeviation', volume.vwapDeviation);

    Object.entries(normalized || {}).forEach(([key, value]) => push(`norm_${key}`, value));
    Object.entries(percentiles || {}).forEach(([key, value]) => push(`pct_${key}`, value));
    Object.entries(flags || {}).forEach(([key, value]) => push(`flag_${key}`, value));
    Object.entries(multiTimeframe || {}).forEach(([tf, aggregate]) => {
      push(`tf_${tf}_return`, aggregate.return);
      push(`tf_${tf}_volatility`, aggregate.volatility);
      push(`tf_${tf}_volumeDelta`, aggregate.volumeDelta);
      push(`tf_${tf}_momentum`, aggregate.momentum);
    });
    Object.entries(deltas || {}).forEach(([key, value]) => push(`delta_${key}`, value));

    return { vector, names };
  }

  private deriveAccuracyRange(probability: number): string | undefined {
    if (probability >= 0.95) return '95-99%';
    if (probability >= 0.9) return '90-95%';
    if (probability >= 0.85) return '85-90%';
    if (probability >= 0.8) return '80-85%';
    if (probability >= 0.75) return '75-80%';
    return undefined;
  }

  /**
   * Get model metrics (from Python service or cache)
   */
  async getModelMetrics(): Promise<ModelMetrics | null> {
    try {
      if (this.usePythonService) {
        const axios = await import('axios');
        const response = await axios.default.get(`${this.modelEndpoint}/metrics`);
        return response.data;
      }
      return null;
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Failed to fetch model metrics');
      return null;
    }
  }

  /**
   * Check if model is ready
   */
  async isModelReady(): Promise<boolean> {
    try {
      if (this.usePythonService) {
        const axios = await import('axios');
        const response = await axios.default.get(`${this.modelEndpoint}/health`);
        return response.data.status === 'ready';
      }
      // Local model is always "ready" (uses rule-based fallback)
      return true;
    } catch {
      return false;
    }
  }
}

export const mlModelService = new MLModelService(process.env.ML_SERVICE_ENDPOINT);

