# DLXTRADE Backend & Deep Research ML

Fastify-based backend APIs, a Vite + React frontend, and a Python ML service that powers the Deep Research ensemble.

---

## Repository Layout

```
dlxtrade/
├── dlxtrade-ws/          # Fastify backend + ML service + scripts (this README)
├── frontend/             # Customer web app
├── data/                 # Raw & labeled parquet partitions (generated)
└── ml-service/           # Python training/backtest service
```

This README focuses on `dlxtrade-ws`, where the backend API, automation scripts, and ML integration live.

---

## Quick Start (Backend + Scripts)

```bash
# Install backend deps
cd dlxtrade-ws
npm install

# Start API with hot reload
npm run dev

# Run unit tests (includes feature engine suite)
npm test
```

The backend expects Postgres + Redis (see `infra/docker-compose.yml`) and Firebase credentials. Copy `.env.example` → `.env` and fill the values that match your environment.

---

## Deep Research ML Pipeline

The production-grade pipeline is intentionally reproducible:

1. **Collect raw data**
   ```bash
   npm run collect:data -- \
     --symbol BTCUSDT \
     --start 2024-01-01 \
     --end 2024-01-07 \
     --timeframe 1m
   ```
   - Streams OHLCV (Binance/Bitget), orderbook top-10, trade ticks, CoinGlass, CryptoQuant, LunarCrush, IntoTheBlock, and NewsAPI sentiment into `data/raw/<symbol>/YYYY-MM.parquet`.

2. **Label snapshots**
   ```bash
   npm run label:data -- \
     --symbol BTCUSDT \
     --timeframe 1m \
     --horizon 15m \
     --sl 0.02 \
     --tp 0.03
   ```
   - Produces `data/labeled/<symbol>/<symbol>_<tf>_<horizon>.parquet` with BUY/SELL/HOLD, max_future_return, and TP/SL hit flags.

3. **Train ensemble (Python)**
   ```bash
   cd ml-service
   python train_model.py \
     --symbol BTCUSDT \
     --timeframe 5m \
     --horizon 15m \
     --data-path ../data/labeled \
     --output ./models
   ```
   - Trains LightGBM + XGBoost + RandomForest, stacks with logistic regression, calibrates (isotonic/sigmoid), mines SHAP background, and writes a bundle to `ml-service/models/<version>/`.

4. **Backtest**
   ```bash
   python backtest.py \
     --symbol BTCUSDT \
     --timeframe 5m \
     --horizon 15m \
     --model-path ./models/latest/model_bundle.joblib \
     --data-path ../data/labeled \
     --days 7 \
     --assert-precision 0.80
   ```
   - Walk-forward replay including fees, slippage, funding, profit factor, drawdown, and confusion matrix, saving artifacts to `results/<model_version>/`.

5. **Integration test (CI uses this)**
   ```bash
   npm run test:replay -- --symbol BTCUSDT --days 7
   ```
   - Executes the Python backtester via `scripts/run_replay_test.js` and fails if precision drops below 0.80.

6. **Deploy**
   - `ml-service/Dockerfile` builds a lightweight Gunicorn server with `/health`, `/ready`, `/predict`, `/metrics`, and `/admin` hooks.
   - The Node backend calls the Python `/predict` endpoint, caches each timestamp for 1s, and falls back to the rule engine if the service is unreachable.

---

## Key Commands

| Command | Description |
| ------- | ----------- |
| `npm run collect:data -- <flags>` | Collect historical snapshots into parquet partitions |
| `npm run label:data -- <flags>` | Build supervised dataset with BUY/SELL/HOLD labels |
| `npm run test:replay -- --symbol BTCUSDT --days 7` | Run 7-day replay + precision assertion |
| `python ml-service/train_model.py ...` | Train ensemble and save bundle |
| `python ml-service/backtest.py ...` | Walk-forward backtest with trading metrics |
| `npm run dev` | Run backend (ts-node-dev) |
| `npm test` | Backend unit tests (includes feature engine suite) |

---

## Backend Enhancements

- `src/services/featureEngine.ts` now supports:
  - Batch processing (`computeBatchFeatureVectors`)
  - Multi-timeframe aggregates (1m/5m/15m/1h returns, volatility, momentum, volume deltas)
  - Dynamic z-score + percentile normalization with running stats
  - Delta features (EMA spreads, RSI spreads, imbalance drift)
- `src/services/ml/mlModelService.ts` now:
  - Calls the Python `/predict` endpoint with ordered feature names
  - Caches per-symbol predictions for 1s
  - Provides calibrated probabilities, SHAP payloads, and accuracy ranges
  - Falls back to rule-based inference if ML is unavailable
- Admin routes expose:
  - `GET /api/admin/research-model/metrics` → latest model metrics
  - `POST /api/admin/research-model/retrain` → spawns `python ml-service/train_model.py ...` in the background with conflict protection
  - `GET /api/admin/research-model/retrain` → job status poll

Frontend `DeepResearchCard` now displays the model’s `accuracyRange` alongside confidence and surfaces the top SHAP explanations returned by the service.

---

## Required Environment Variables

Add the following to `.env` (backend) and the ML service deployment as needed:

| Variable | Purpose |
| ---- | ---- |
| `COINGLASS_KEY` | CoinGlass derivatives data |
| `CRYPTOQUANT_KEY` | CryptoQuant exchange flows |
| `LUNARCRUSH_KEY` | LunarCrush sentiment |
| `INTO_THE_BLOCK_KEY` | IntoTheBlock whale metrics |
| `NEWSAPI_KEY` | NewsAPI headlines sentiment |
| `BINANCE_APIKEY` / `BINANCE_APISECRET` | Binance REST + live orderbook |
| `BITGET_APIKEY` / `BITGET_APISECRET` | Bitget OHLCV |
| `ML_SERVICE_URL` | Backend → Python inference endpoint (default `http://localhost:5001`) |
| `MODEL_BUNDLE_PATH` | Python service path to `model_bundle.joblib` |

Standard backend env vars (`DATABASE_URL`, `REDIS_URL`, `FIREBASE_*`, `JWT_SECRET`, etc.) remain unchanged.

---

## CI

`.github/workflows/ci.yml` now includes an ML replay job that triggers on the `ml-training` branch. The job installs Node + Python deps, runs `npm run test:replay`, and fails if precision < 0.80.

---

## API Reference (Highlights)

| Endpoint | Description |
| -------- | ----------- |
| `GET /health` | Backend health |
| `GET /api/admin/research-model/metrics` | Current ML metrics from Python bundle metadata |
| `POST /api/admin/research-model/retrain` | Queue a training job (`symbol`, `timeframe`, `horizon`, `synthetic`) |
| `GET /api/deep-research/:symbol` | Research engine output (now includes `explanations[]` + `accuracyRange`) |

The Python service mirrors with `/health`, `/ready`, `/predict`, `/metrics`.

---

## Testing & Quality

```bash
# Backend unit tests (includes feature engine coverage)
npm test

# ML backtest regression
npm run test:replay -- --symbol BTCUSDT --days 7
```

CI (GitHub Actions) runs lint/typecheck/test for backend & frontend plus the replay job on the `ml-training` branch.

---

## License

MIT

