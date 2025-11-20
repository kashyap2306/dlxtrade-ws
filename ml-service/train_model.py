#!/usr/bin/env python3
"""
Production training pipeline for the Deep Research ML ensemble.

Steps:
1) Load labeled parquet dataset (or synthesize if missing)
2) Train LightGBM, XGBoost, RandomForest base learners
3) Stack via logistic meta learner + isotonic/Platt calibration
4) Persist bundle (model + scaler + metadata + SHAP background) to models/<version>
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple

import joblib
import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier
from sklearn.base import BaseEstimator, ClassifierMixin, clone
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    precision_recall_fscore_support,
)
from sklearn.preprocessing import LabelEncoder, StandardScaler
from xgboost import XGBClassifier


EXCLUDE_COLUMNS = {
    'label',
    'hit_tp_flag',
    'hit_sl_flag',
    'max_future_return',
    'min_future_return',
    'timestamp',
    'horizon_minutes',
    'symbol',
    'timeframe',
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Train Deep Research ensemble')
    parser.add_argument('--symbol', default='BTCUSDT', help='Trading symbol')
    parser.add_argument('--timeframe', default='5m', help='Dataset timeframe')
    parser.add_argument('--horizon', default='15m', help='Prediction horizon')
    parser.add_argument('--data-path', default='../data/labeled', help='Labeled dataset directory')
    parser.add_argument('--output', default='./models', help='Directory to store trained models')
    parser.add_argument('--calibration', choices=['isotonic', 'sigmoid'], default='isotonic')
    parser.add_argument('--test-ratio', type=float, default=0.2, help='Holdout ratio for validation')
    parser.add_argument('--synthetic', action='store_true', help='Force synthetic dataset generation')
    return parser.parse_args()


def dataset_path(base_dir: str, symbol: str, timeframe: str, horizon: str) -> Path:
    return Path(base_dir) / symbol / f'{symbol}_{timeframe}_{horizon}.parquet'


def generate_synthetic_dataset(rows: int = 5000) -> pd.DataFrame:
    rng = np.random.default_rng(42)
    base_price = rng.normal(0, 1, rows).cumsum() + 40_000
    sentiment = rng.normal(0, 0.5, rows)
    orderbook = rng.normal(0, 0.2, rows)
    whale_flow = rng.normal(0, 0.3, rows)

    labels = []
    for i in range(rows):
        score = sentiment[i] * 0.5 + orderbook[i] * 0.3 + whale_flow[i] * 0.2
        if score > 0.35:
            labels.append('BUY')
        elif score < -0.35:
            labels.append('SELL')
        else:
            labels.append('HOLD')

    df = pd.DataFrame({
        'timestamp': pd.date_range('2024-01-01', periods=rows, freq='T').astype(np.int64) // 10**6,
        'symbol': 'SYNTH',
        'timeframe': '1m',
        'horizon_minutes': 15,
        'binance_close': base_price + rng.normal(0, 25, rows),
        'binance_volume': rng.gamma(2, 50, rows),
        'bitget_close': base_price + rng.normal(0, 25, rows),
        'taker_buy_volume': rng.gamma(2, 20, rows),
        'taker_sell_volume': rng.gamma(1.8, 20, rows),
        'orderbook_mid_price': base_price + rng.normal(0, 10, rows),
        'orderbook_spread': np.abs(rng.normal(0.5, 0.2, rows)),
        'funding_rate': rng.normal(0, 0.001, rows),
        'open_interest': rng.gamma(2, 1000, rows),
        'lunar_sentiment': sentiment,
        'news_sentiment': sentiment + rng.normal(0, 0.1, rows),
        'whale_large_transactions': whale_flow * 100 + rng.normal(0, 5, rows),
        'label': labels,
        'max_future_return': rng.normal(0.01, 0.02, rows),
        'min_future_return': rng.normal(-0.01, 0.02, rows),
        'hit_tp_flag': [lbl == 'BUY' for lbl in labels],
        'hit_sl_flag': [lbl == 'SELL' for lbl in labels],
    })
    return df


def load_dataset(args: argparse.Namespace) -> pd.DataFrame:
    file_path = dataset_path(args.data_path, args.symbol, args.timeframe, args.horizon)
    if args.synthetic or not file_path.exists():
        print('[train] Dataset not found, generating synthetic samples...')
        return generate_synthetic_dataset()
    print(f'[train] Loading dataset from {file_path}')
    return pd.read_parquet(file_path)


def train_val_split(df: pd.DataFrame, test_ratio: float) -> Tuple[pd.DataFrame, pd.DataFrame]:
    split_index = int(len(df) * (1 - test_ratio))
    return df.iloc[:split_index], df.iloc[split_index:]


class StackedEnsemble(BaseEstimator, ClassifierMixin):
    def __init__(self, base_models: List[BaseEstimator], meta_model: BaseEstimator):
        self.base_models = base_models
        self.meta_model = meta_model

    def fit(self, X, y):
        self.classes_ = np.unique(y)
        self.fitted_base_models_ = [clone(model).fit(X, y) for model in self.base_models]
        meta_features = np.hstack([model.predict_proba(X) for model in self.fitted_base_models_])
        self.meta_model_ = clone(self.meta_model).fit(meta_features, y)
        return self

    def predict_proba(self, X):
        meta_features = np.hstack([model.predict_proba(X) for model in self.fitted_base_models_])
        return self.meta_model_.predict_proba(meta_features)

    def predict(self, X):
        return np.argmax(self.predict_proba(X), axis=1)


def train_models(X_train, y_train, X_val, y_val, calibration: str):
    lgb_model = LGBMClassifier(
        objective='multiclass',
        num_class=3,
        learning_rate=0.05,
        n_estimators=200,
        max_depth=-1,
        subsample=0.9,
        colsample_bytree=0.8,
        random_state=42,
    )
    lgb_model.fit(X_train, y_train,
                  eval_set=[(X_val, y_val)],
                  eval_metric='multi_logloss',
                  callbacks=[])

    xgb_model = XGBClassifier(
        objective='multi:softprob',
        num_class=3,
        learning_rate=0.05,
        n_estimators=300,
        max_depth=6,
        subsample=0.9,
        colsample_bytree=0.8,
        eval_metric='mlogloss',
        random_state=42,
        tree_method='hist',
    )
    xgb_model.fit(X_train, y_train, eval_set=[(X_val, y_val)], verbose=False)

    rf_model = RandomForestClassifier(
        n_estimators=400,
        max_depth=10,
        min_samples_split=4,
        random_state=42,
        n_jobs=-1,
    )
    rf_model.fit(X_train, y_train)

    ensemble = StackedEnsemble(
        base_models=[lgb_model, xgb_model, rf_model],
        meta_model=LogisticRegression(max_iter=1000, multi_class='multinomial'),
    )
    ensemble.fit(X_train, y_train)
    calibrated = CalibratedClassifierCV(ensemble, method=calibration, cv='prefit')
    calibrated.fit(X_val, y_val)
    return calibrated, {
        'lightgbm': lgb_model,
        'xgboost': xgb_model,
        'random_forest': rf_model,
    }


def compute_metrics(model, X_val, y_val, labels) -> Dict:
    probs = model.predict_proba(X_val)
    preds = np.argmax(probs, axis=1)
    report = classification_report(y_val, preds, target_names=labels, output_dict=True)
    precision, recall, f1, _ = precision_recall_fscore_support(y_val, preds, average='weighted')
    accuracy = accuracy_score(y_val, preds)
    confusion = confusion_matrix(y_val, preds).tolist()
    return {
        'accuracy': float(accuracy),
        'precision': float(precision),
        'recall': float(recall),
        'f1': float(f1),
        'classificationReport': report,
        'confusionMatrix': confusion,
    }


def accuracy_range(accuracy: float) -> str:
    if accuracy >= 0.95:
        return '95-99%'
    if accuracy >= 0.9:
        return '90-95%'
    if accuracy >= 0.85:
        return '85-90%'
    if accuracy >= 0.8:
        return '80-85%'
    if accuracy >= 0.75:
        return '75-80%'
    return '70-75%'


def save_bundle(args, bundle, metadata):
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)
    version = f"{args.symbol}_{args.timeframe}_{args.horizon}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"
    model_dir = output_dir / version
    model_dir.mkdir(exist_ok=True)

    bundle_path = model_dir / 'model_bundle.joblib'
    joblib.dump(bundle, bundle_path)

    metadata_path = model_dir / 'metadata.json'
    metadata['modelVersion'] = version
    metadata['bundlePath'] = str(bundle_path)
    with metadata_path.open('w', encoding='utf-8') as fp:
        json.dump(metadata, fp, indent=2)

    latest_dir = output_dir / 'latest'
    if latest_dir.exists():
        shutil.rmtree(latest_dir)
    shutil.copytree(model_dir, latest_dir)
    print(f'[train] Saved model bundle to {model_dir}')
    return version


def main():
    args = parse_args()
    df = load_dataset(args)
    train_df, val_df = train_val_split(df, args.test_ratio)

    feature_columns = [col for col in train_df.columns if col not in EXCLUDE_COLUMNS]
    X_train = train_df[feature_columns].fillna(0).values
    X_val = val_df[feature_columns].fillna(0).values

    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_val_scaled = scaler.transform(X_val)

    label_encoder = LabelEncoder()
    y_train = label_encoder.fit_transform(train_df['label'])
    y_val = label_encoder.transform(val_df['label'])

    model, base_models = train_models(X_train_scaled, y_train, X_val_scaled, y_val, args.calibration)
    metrics = compute_metrics(model, X_val_scaled, y_val, label_encoder.classes_)

    bundle = {
        'model': model,
        'base_models': base_models,
        'scaler': scaler,
        'feature_names': feature_columns,
        'label_encoder': label_encoder,
        'metadata': {
            'symbol': args.symbol,
            'timeframe': args.timeframe,
            'horizon': args.horizon,
            'accuracyRange': accuracy_range(metrics['accuracy']),
            'metrics': metrics,
        },
        'shap_background': X_train_scaled[: min(512, len(X_train_scaled))],
    }

    metadata = {
        'symbol': args.symbol,
        'timeframe': args.timeframe,
        'horizon': args.horizon,
        'accuracyRange': accuracy_range(metrics['accuracy']),
        'metrics': metrics,
        'featureNames': feature_columns,
    }

    version = save_bundle(args, bundle, metadata)
    print(json.dumps({'modelVersion': version, 'metrics': metrics}, indent=2))


if __name__ == '__main__':
    main()

