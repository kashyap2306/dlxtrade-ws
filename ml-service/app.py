#!/usr/bin/env python3
"""
Flask API for ML Model Inference
Provides prediction endpoint for Deep Research engine
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import joblib
import numpy as np
import shap
import os
from datetime import datetime

app = Flask(__name__)
CORS(app)

DEFAULT_MODEL_PATH = os.getenv('MODEL_BUNDLE_PATH', './models/latest/model_bundle.joblib')
model_bundles = {}
shap_explainers = {}

def load_model(model_path: str):
    """Load trained model bundle (scaler, ensemble, metadata)."""
    if model_path in model_bundles:
        return model_bundles[model_path]

    if not os.path.exists(model_path):
        return None

    bundle = joblib.load(model_path)
    model_bundles[model_path] = bundle

    lightgbm_model = bundle.get('base_models', {}).get('lightgbm')
    background = bundle.get('shap_background')
    if lightgbm_model is not None:
        try:
            explainer = shap.TreeExplainer(lightgbm_model, data=background)
            shap_explainers[model_path] = explainer
        except Exception as exc:
            print(f'SHAP initialization failed: {exc}')
            shap_explainers[model_path] = None
    else:
        shap_explainers[model_path] = None

    return bundle

def format_explanations(feature_names: list, contributions: np.ndarray):
    """Generate ranked explanation strings from SHAP contributions."""
    feature_contribs = list(zip(feature_names, contributions))
    feature_contribs.sort(key=lambda x: x[1], reverse=True)

    top_positive = [fc for fc in feature_contribs if fc[1] > 0][:6]
    top_negative = [fc for fc in feature_contribs if fc[1] < 0][-3:]

    explanations = []
    for name, value in top_positive:
        explanations.append(f"{name} contributes +{value:.3f} — supports {get_signal_from_feature(name)}")

    for name, value in top_negative:
        explanations.append(f"{name} contributes {value:.3f} — reduces confidence")

    return explanations[:6]

def get_signal_from_feature(feature_name: str) -> str:
    """Map feature to signal direction"""
    if 'rsi' in feature_name.lower() or 'oversold' in feature_name.lower():
        return 'LONG'
    if 'overbought' in feature_name.lower():
        return 'SHORT'
    if 'imbalance' in feature_name.lower() and 'buy' in feature_name.lower():
        return 'LONG'
    if 'imbalance' in feature_name.lower() and 'sell' in feature_name.lower():
        return 'SHORT'
    return 'signal'

@app.route('/health', methods=['GET'])
def health():
    """Health check"""
    bundle = load_model(DEFAULT_MODEL_PATH)
    status = 'ready' if bundle else 'unavailable'
    model_version = bundle.get('metadata', {}).get('modelVersion') if bundle else None
    return jsonify({
        'status': status,
        'models_loaded': len(model_bundles),
        'modelVersion': model_version,
        'timestamp': datetime.now().isoformat()
    })

@app.route('/ready', methods=['GET'])
def ready():
    """Kubernetes-style readiness probe"""
    bundle = load_model(DEFAULT_MODEL_PATH)
    if bundle:
        return jsonify({'status': 'ready'})
    return jsonify({'status': 'unavailable'}), 503

@app.route('/predict', methods=['POST'])
def predict():
    """Predict signal from feature vector"""
    try:
        data = request.json
        features = np.array(data.get('features', []), dtype=float)
        requested_names = data.get('featureNames')

        if features.size == 0:
            return jsonify({'error': 'No features provided'}), 400

        model_path = os.getenv('MODEL_BUNDLE_PATH', DEFAULT_MODEL_PATH)
        bundle = load_model(model_path)
        if bundle is None:
            return jsonify({'error': 'Model not ready'}), 503

        feature_names = bundle.get('feature_names', [f'feature_{i}' for i in range(len(features))])
        if requested_names and len(requested_names) != len(features):
            return jsonify({'error': 'Feature count mismatch'}), 400

        if requested_names:
            index_map = {name: idx for idx, name in enumerate(requested_names)}
            ordered = [features[index_map.get(name, -1)] if index_map.get(name, -1) >= 0 else 0 for name in feature_names]
            feature_vector = np.array(ordered, dtype=float)
        else:
            feature_vector = features

        scaler = bundle['scaler']
        model = bundle['model']
        label_encoder = bundle['label_encoder']

        scaled = scaler.transform(feature_vector.reshape(1, -1))
        probabilities = model.predict_proba(scaled)[0]
        prediction_idx = int(np.argmax(probabilities))
        signal = label_encoder.inverse_transform([prediction_idx])[0]
        probability = float(probabilities[prediction_idx])

        explainer = shap_explainers.get(model_path)
        shap_payload = None
        explanations = []
        if explainer is not None:
            shap_values = explainer.shap_values(scaled)
            if isinstance(shap_values, list):
                contributions = shap_values[prediction_idx][0]
                base_value = explainer.expected_value[prediction_idx] if isinstance(explainer.expected_value, list) else explainer.expected_value
            else:
                contributions = shap_values[0]
                base_value = explainer.expected_value
            explanations = format_explanations(feature_names, contributions)
            shap_payload = {
                'featureNames': feature_names,
                'values': contributions.tolist(),
                'baseValue': float(base_value) if base_value is not None else None,
            }

        metadata = bundle.get('metadata', {})
        return jsonify({
            'signal': signal,
            'probability': probability,
            'confidence': int(probability * 100),
            'accuracyRange': metadata.get('accuracyRange'),
            'explanations': explanations,
            'probabilities': {
                'BUY': float(probabilities[label_encoder.transform(['BUY'])[0]]) if 'BUY' in label_encoder.classes_ else None,
                'SELL': float(probabilities[label_encoder.transform(['SELL'])[0]]) if 'SELL' in label_encoder.classes_ else None,
                'HOLD': float(probabilities[label_encoder.transform(['HOLD'])[0]]) if 'HOLD' in label_encoder.classes_ else None,
            },
            'shap': shap_payload,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/metrics', methods=['GET'])
def metrics():
    """Get model performance metrics"""
    bundle = load_model(os.getenv('MODEL_BUNDLE_PATH', DEFAULT_MODEL_PATH))
    if not bundle:
        return jsonify({'error': 'Model not ready'}), 503
    metadata = bundle.get('metadata') or {}
    metrics_payload = metadata.get('metrics') or metadata
    metrics_payload['lastUpdated'] = datetime.now().isoformat()
    return jsonify(metrics_payload)

if __name__ == '__main__':
    port = int(os.getenv('PORT', 5001))
    app.run(host='0.0.0.0', port=port, debug=False)

