FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MODEL_BUNDLE_PATH=/app/models/latest/model_bundle.joblib

WORKDIR /app

COPY requirements.txt .
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && pip install --no-cache-dir -r requirements.txt \
    && rm -rf /var/lib/apt/lists/*

COPY . .

EXPOSE 5001

HEALTHCHECK --interval=30s --timeout=5s CMD curl -f http://localhost:5001/ready || exit 1

CMD ["gunicorn", "--bind", "0.0.0.0:5001", "app:app"]

