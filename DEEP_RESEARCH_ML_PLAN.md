# Production-Grade Deep Research ML Model - Implementation Plan

## Overview
Upgrade researchEngine to a production-grade ML model targeting >90% classification accuracy for BUY/SELL/HOLD signals.

## Architecture

### Phase 1: Data Connectors (TypeScript)
- ✅ Bitget adapter (orderbook, WS ticker)
- ✅ Binance adapter (orderbook, ticker)
- ⬜ CoinGlass adapter (funding, OI, liquidations)
- ⬜ IntoTheBlock adapter (whale movements)
- ⬜ News API adapter (sentiment)
- ✅ CryptoQuant adapter (existing - enhance)
- ✅ LunarCrush adapter (existing - enhance)
- ⬜ Kaiko/CoinMetrics adapter (OI, derivatives)

### Phase 2: Feature Engineering Service (TypeScript)
- Technical indicators: RSI, MACD, EMA, ADX
- Orderbook features: imbalance, depth, volume
- Trade features: taker buy/sell ratio
- Volume features: VWAP, volume spikes
- Derivatives: funding rate, OI delta
- On-chain: exchange flows, whale movements
- Social: sentiment scores
- Normalization: z-score, percentiles

### Phase 3: ML Pipeline (Python Bridge)
- Labeling service (BUY/SELL/HOLD based on price movement)
- Training pipeline (LightGBM, XGBoost, RandomForest, ensemble)
- Model storage and versioning
- Probability calibration
- SHAP explainability

### Phase 4: Inference & Integration
- Real-time feature computation (<500ms)
- Model inference service
- Risk controls and thresholds
- Explanation generation

### Phase 5: Backtesting & Evaluation
- Walk-forward backtester
- Evaluation metrics (precision, recall, F1, profit factor)
- Model drift detection
- Retraining pipeline

## Implementation Strategy

Since LightGBM/XGBoost are Python libraries, we'll use:
1. **TypeScript** for data connectors, feature engineering, API layer
2. **Python microservice** for ML training/inference (via HTTP API or child_process)
3. **Model artifacts** stored in S3/local storage
4. **Real-time inference** via Python service or ONNX runtime

## File Structure

```
src/services/
  - researchEngine.ts (main orchestrator)
  - featureEngine.ts (feature computation)
  - mlModelService.ts (ML inference wrapper)
  - dataConnectors/
    - bitgetConnector.ts
    - coinglassConnector.ts
    - intotheblockConnector.ts
    - newsApiConnector.ts
  - ml/
    - trainingPipeline.ts (Python bridge)
    - backtester.ts
    - evaluator.ts
```

## Next Steps
1. Enhance existing adapters
2. Create new data connectors
3. Build feature engineering service
4. Set up Python ML service
5. Implement training pipeline
6. Add backtesting
7. Integrate with researchEngine

