#!/usr/bin/env python3
"""
Walk-forward backtester for Deep Research ensemble.

Simulates trades using labeled dataset + model bundle to compute:
 - Confusion matrix / precision / recall / F1 / accuracy
 - Profit factor, max drawdown, cumulative PnL
 - Funding + fee impact via configurable bps inputs
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    precision_recall_fscore_support,
)

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
    parser = argparse.ArgumentParser(description='Backtest Deep Research model')
    parser.add_argument('--symbol', default='BTCUSDT')
    parser.add_argument('--timeframe', default='5m')
    parser.add_argument('--horizon', default='15m')
    parser.add_argument('--data-path', default='../data/labeled')
    parser.add_argument('--model-path', default='./models/latest/model_bundle.joblib')
    parser.add_argument('--days', type=int, default=7, help='Number of trailing days to evaluate')
    parser.add_argument('--fee-bps', type=float, default=7.5, help='Trading fee in basis points')
    parser.add_argument('--slippage-bps', type=float, default=5, help='Slippage in basis points')
    parser.add_argument('--funding-bps', type=float, default=1, help='Funding impact per trade in bps')
    parser.add_argument('--assert-precision', type=float, default=0.8, help='Fail if precision below threshold')
    parser.add_argument('--synthetic', action='store_true', help='Use synthetic dataset fallback')
    return parser.parse_args()


def dataset_path(base_dir: str, symbol: str, timeframe: str, horizon: str) -> Path:
    return Path(base_dir) / symbol / f'{symbol}_{timeframe}_{horizon}.parquet'


def generate_synthetic_dataset(rows: int = 3000) -> pd.DataFrame:
    rng = np.random.default_rng(99)
    labels = rng.choice(['BUY', 'SELL', 'HOLD'], size=rows, p=[0.35, 0.35, 0.3])
    df = pd.DataFrame({
        'timestamp': pd.date_range(datetime.utcnow() - timedelta(days=rows // 1440), periods=rows, freq='T').astype(np.int64) // 10**6,
        'symbol': 'SYNTH',
        'timeframe': '1m',
        'horizon_minutes': 15,
        'binance_close': rng.normal(40_000, 300, rows),
        'binance_volume': rng.gamma(2, 50, rows),
        'bitget_close': rng.normal(40_000, 300, rows),
        'taker_buy_volume': rng.gamma(2, 20, rows),
        'taker_sell_volume': rng.gamma(2, 20, rows),
        'orderbook_mid_price': rng.normal(40_000, 100, rows),
        'orderbook_spread': np.abs(rng.normal(0.5, 0.2, rows)),
        'funding_rate': rng.normal(0, 0.001, rows),
        'open_interest': rng.gamma(2, 1_000, rows),
        'lunar_sentiment': rng.normal(0, 0.2, rows),
        'news_sentiment': rng.normal(0, 0.2, rows),
        'whale_large_transactions': rng.normal(0, 10, rows),
        'label': labels,
        'max_future_return': rng.normal(0.01, 0.02, rows),
        'min_future_return': rng.normal(-0.01, 0.02, rows),
    })
    return df


def load_dataset(args: argparse.Namespace) -> pd.DataFrame:
    file_path = dataset_path(args.data_path, args.symbol, args.timeframe, args.horizon)
    if args.synthetic or not file_path.exists():
        print('[backtest] Using synthetic dataset')
        return generate_synthetic_dataset()
    print(f'[backtest] Loading dataset from {file_path}')
    return pd.read_parquet(file_path)


def filter_last_days(df: pd.DataFrame, days: int) -> pd.DataFrame:
    if 'timestamp' not in df.columns:
        return df
    cutoff = df['timestamp'].max() - days * 24 * 60 * 60 * 1000
    return df[df['timestamp'] >= cutoff]


def load_bundle(bundle_path: Path):
    if not bundle_path.exists():
        raise FileNotFoundError(f'Model bundle not found: {bundle_path}')
    return joblib.load(bundle_path)


@dataclass
class TradeResult:
    pnl: float
    direction: str


def simulate_trades(df: pd.DataFrame, predictions: List[str], fee: float, slippage: float, funding: float) -> Dict:
    equity_curve = [0.0]
    trades: List[TradeResult] = []
    for i, (_, row) in enumerate(df.iterrows()):
        pred = predictions[i]
        pnl = 0.0
        if pred == 'BUY':
            pnl = float(row.get('max_future_return', 0))
        elif pred == 'SELL':
            pnl = float(abs(row.get('min_future_return', 0)))
        pnl -= (fee + slippage + funding) / 10000.0
        trades.append(TradeResult(pnl=pnl, direction=pred))
        equity_curve.append(equity_curve[-1] + pnl)

    equity_series = np.array(equity_curve)
    peak = np.maximum.accumulate(equity_series)
    drawdown = (equity_series - peak)
    max_drawdown = float(drawdown.min())
    gains = sum(trade.pnl for trade in trades if trade.pnl > 0)
    losses = abs(sum(trade.pnl for trade in trades if trade.pnl < 0)) or 1e-9
    profit_factor = gains / losses
    total_pnl = float(equity_series[-1])
    return {
        'profitFactor': profit_factor,
        'maxDrawdown': max_drawdown,
        'totalPnl': total_pnl,
        'equityCurve': equity_series.tolist(),
    }


def run_backtest(args: argparse.Namespace) -> Dict:
    df = filter_last_days(load_dataset(args), args.days)
    bundle = load_bundle(Path(args.model_path))
    feature_names = bundle['feature_names']
    scaler = bundle['scaler']
    model = bundle['model']
    label_encoder = bundle['label_encoder']

    features = df[feature_names].fillna(0)
    X = scaler.transform(features.values)
    probas = model.predict_proba(X)
    preds_idx = np.argmax(probas, axis=1)
    predictions = label_encoder.inverse_transform(preds_idx)

    metrics = classification_report(df['label'], predictions, output_dict=True)
    precision, recall, f1, _ = precision_recall_fscore_support(df['label'], predictions, average='weighted')
    accuracy = accuracy_score(df['label'], predictions)
    conf = confusion_matrix(df['label'], predictions, labels=label_encoder.classes_).tolist()

    trading = simulate_trades(
        df,
        predictions,
        fee=args.fee_bps,
        slippage=args.slippage_bps,
        funding=args.funding_bps,
    )

    summary = {
        'symbol': args.symbol,
        'timeframe': args.timeframe,
        'horizon': args.horizon,
        'rows': int(len(df)),
        'metrics': {
            'precision': float(precision),
            'recall': float(recall),
            'f1': float(f1),
            'accuracy': float(accuracy),
            'classificationReport': metrics,
            'confusionMatrix': conf,
        },
        'trading': trading,
        'args': vars(args),
    }
    return summary


def persist_results(summary: Dict, model_path: Path):
    version = summary['args'].get('modelVersion') or Path(model_path).parent.name
    results_dir = Path('./results') / version
    results_dir.mkdir(parents=True, exist_ok=True)
    output_file = results_dir / f'backtest_{datetime.utcnow().strftime("%Y%m%d_%H%M%S")}.json'
    with output_file.open('w', encoding='utf-8') as fp:
        json.dump(summary, fp, indent=2)
    return output_file


def main():
    args = parse_args()
    summary = run_backtest(args)
    summary['args']['modelVersion'] = Path(args.model_path).parent.name
    output_file = persist_results(summary, Path(args.model_path))
    print(json.dumps({'resultsFile': str(output_file), **summary['metrics']}, indent=2))

    if summary['metrics']['precision'] < args.assert_precision:
        raise SystemExit(f"Precision {summary['metrics']['precision']:.2f} below threshold {args.assert_precision}")


if __name__ == '__main__':
    main()


