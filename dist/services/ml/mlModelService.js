"use strict";
/**
 * ML Model Service
 * Wrapper for ML model inference (connects to Python service or uses ONNX)
 *
 * This service provides a TypeScript interface to ML models.
 * Actual model training/inference happens in a Python service.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.mlModelService = exports.MLModelService = void 0;
const logger_1 = require("../../utils/logger");
class MLModelService {
    constructor(modelEndpoint) {
        this.cachedPredictions = new Map();
        this.cacheTTL = 1000; // 1 second
        // If Python service endpoint provided, use it; otherwise use local inference
        this.modelEndpoint = modelEndpoint || process.env.ML_SERVICE_URL || 'http://localhost:5001';
        this.usePythonService = true;
    }
    /**
     * Predict signal from feature vector
     * This calls the Python ML service or uses ONNX runtime
     */
    async predict(featureVector, symbol) {
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
            }
            else {
                // Use local inference (would require ONNX runtime or similar)
                // For now, return a placeholder that uses rule-based logic
                const prediction = await this.predictLocal(featureVector);
                this.cachedPredictions.set(cacheKey, { prediction, timestamp: Date.now() });
                return prediction;
            }
        }
        catch (error) {
            logger_1.logger.error({ error: error.message, symbol }, 'ML model prediction failed');
            // Fallback to rule-based prediction
            return this.predictLocal(featureVector);
        }
    }
    /**
     * Predict via Python ML service (HTTP API)
     */
    async predictViaPythonService(featureVector, symbol) {
        const axios = await Promise.resolve().then(() => __importStar(require('axios')));
        const { vector, names } = this.flattenFeatureVector(featureVector);
        const response = await axios.default.post(`${this.modelEndpoint}/predict`, {
            symbol,
            timeframe: '5m',
            features: vector,
            featureNames: names,
            timestamp: featureVector.timestamp,
        }, { timeout: Number(process.env.ML_SERVICE_TIMEOUT || 4000) });
        const shapValues = {};
        if (Array.isArray(response.data?.shap?.featureNames) && Array.isArray(response.data?.shap?.values)) {
            response.data.shap.featureNames.forEach((name, idx) => {
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
    async predictLocal(featureVector) {
        const { technical, orderbook, trades, volume, flags } = featureVector;
        // Rule-based signal generation (temporary until ML model is ready)
        let buyScore = 0;
        let sellScore = 0;
        const explanations = [];
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
        let signal = 'HOLD';
        let probability = 0.5;
        if (buyScore > sellScore && buyScore >= 2) {
            signal = 'BUY';
            probability = Math.min(0.95, 0.5 + (buyScore / 10));
        }
        else if (sellScore > buyScore && sellScore >= 2) {
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
    flattenFeatureVector(featureVector) {
        const vector = [];
        const names = [];
        const push = (name, value) => {
            let numericValue = 0;
            if (typeof value === 'boolean') {
                numericValue = value ? 1 : 0;
            }
            else if (value !== null && value !== undefined && !Number.isNaN(Number(value))) {
                numericValue = Number(value);
            }
            vector.push(numericValue);
            names.push(name);
        };
        const { technical, orderbook, trades, volume, normalized, percentiles, flags, multiTimeframe, deltas } = featureVector;
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
    deriveAccuracyRange(probability) {
        if (probability >= 0.95)
            return '95-99%';
        if (probability >= 0.9)
            return '90-95%';
        if (probability >= 0.85)
            return '85-90%';
        if (probability >= 0.8)
            return '80-85%';
        if (probability >= 0.75)
            return '75-80%';
        return undefined;
    }
    /**
     * Get model metrics (from Python service or cache)
     */
    async getModelMetrics() {
        try {
            if (this.usePythonService) {
                const axios = await Promise.resolve().then(() => __importStar(require('axios')));
                const response = await axios.default.get(`${this.modelEndpoint}/metrics`);
                return response.data;
            }
            return null;
        }
        catch (error) {
            logger_1.logger.warn({ error: error.message }, 'Failed to fetch model metrics');
            return null;
        }
    }
    /**
     * Check if model is ready
     */
    async isModelReady() {
        try {
            if (this.usePythonService) {
                const axios = await Promise.resolve().then(() => __importStar(require('axios')));
                const response = await axios.default.get(`${this.modelEndpoint}/health`);
                return response.data.status === 'ready';
            }
            // Local model is always "ready" (uses rule-based fallback)
            return true;
        }
        catch {
            return false;
        }
    }
}
exports.MLModelService = MLModelService;
exports.mlModelService = new MLModelService(process.env.ML_SERVICE_ENDPOINT);
