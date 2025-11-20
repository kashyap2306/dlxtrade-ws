# Deep Research ML Service

Flask + Gunicorn microservice backed by LightGBM / XGBoost / RandomForest ensemble with calibrated stacking, SHAP explanations, and walk-forward backtesting.

---

## Installation
```bash
cd ml-service
python -m venv venv
source venv/bin/activate              # Windows: venv\Scripts\activate
pip install --upgrade pip
pip install -r requirements.txt
```

Run the API locally:
```bash
MODEL_BUNDLE_PATH=./models/latest/model_bundle.joblib python app.py
# or
gunicorn --bind 0.0.0.0:5001 app:app
```

Docker:
```bash
docker build -t deep-research-ml ml-service
docker run -p 5001:5001 -e MODEL_BUNDLE_PATH=/app/models/latest/model_bundle.joblib deep-research-ml
```

---

## CLI Workflows

### Train
```bash
python train_model.py \
  --symbol BTCUSDT \
  --timeframe 5m \
  --horizon 15m \
  --data-path ../data/labeled \
  --output ./models
```
Expected output: `models/<symbol>_<tf>_<horizon>_<timestamp>/model_bundle.joblib` plus `metadata.json`. The `latest/` directory is refreshed automatically.

### Backtest
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
Outputs `results/<model_version>/backtest_<timestamp>.json` with accuracy, precision, recall, confusion matrix, profit factor, drawdown, and equity curve.

---

## API Surface

| Method & Path | Description |
| ------------- | ----------- |
| `GET /health` | Lightweight health (also returns `modelVersion`) |
| `GET /ready` | Kubernetes readiness probe |
| `GET /metrics` | Model metrics from bundle metadata |
| `POST /predict` | Predict signal + calibrated probability + SHAP |

### Predict Payload
```jsonc
POST /predict
{
  "symbol": "BTCUSDT",
  "timeframe": "5m",
  "features": [ ...vector of floats... ],
  "featureNames": [ "...matching order..." ],
  "timestamp": 1732108800000
}
```
**Response**
```json
{
  "signal": "BUY",
  "probability": 0.91,
  "confidence": 91,
  "accuracyRange": "90-95%",
  "probabilities": { "BUY": 0.91, "SELL": 0.04, "HOLD": 0.05 },
  "explanations": [
    "norm_rsi5 contributes +0.214 — supports LONG",
    "delta_ema12Minus26 contributes +0.127 — supports LONG"
  ],
  "shap": {
    "featureNames": ["norm_rsi5", "delta_ema12Minus26", "..."],
    "values": [0.214, 0.127, "..."],
    "baseValue": 0.01
  }
}
```

---

## Environment Variables

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `PORT` | `5001` | Flask/Gunicorn port |
| `MODEL_BUNDLE_PATH` | `./models/latest/model_bundle.joblib` | Location of saved bundle |
| `ML_SERVICE_TIMEOUT` | `4000` (ms) | Backend → service request timeout |
| `PYTHON_BIN` | `python` | Override when spawning training jobs from Node |

---

## Dependencies

- Python 3.11+
- lightgbm, xgboost, scikit-learn, shap
- pandas, numpy, pyarrow
- flask, flask-cors, gunicorn

The Dockerfile installs `curl` for the built-in `HEALTHCHECK` and runs Gunicorn with the bundle mounted under `/app/models`.

